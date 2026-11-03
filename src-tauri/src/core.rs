//! 摸鱼小狐 · 计算核心（core.js 的 Rust 复刻）
//!
//! 与 `src/js/core.js` 保持口径一致，用于后端（托盘文字、通知、校验）计算。
//! 前端 UI 仍使用 core.js 渲染，两者通过一致性测试夹具对齐。

#![allow(dead_code)]

use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, Datelike, Duration as ChronoDuration, Local, NaiveDate, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

pub const DAY_MS: i64 = 86_400_000;
pub const LEGAL_PAY_DAYS: f64 = 21.75;
pub const WEEK_NAMES: [&str; 7] = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/* ---------------- 工作设置 ---------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub rest_mode: String,
    pub custom_rest_days: Vec<i64>,
    pub big_small_anchor: Option<String>,
    pub work_start: String,
    pub work_end: String,
    pub lunch_enabled: bool,
    pub lunch_start: String,
    pub lunch_end: String,
    pub monthly_salary: f64,
    pub pay_days_mode: String,
    pub custom_pay_days: f64,
    pub payday: i64,
    pub special_dates: BTreeMap<String, String>,
}

/* ---------------- 日期工具 ---------------- */

pub fn date_key(d: NaiveDate) -> String {
    format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day())
}

pub fn parse_date_key(k: &str) -> Option<NaiveDate> {
    let parts: Vec<&str> = k.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let d: u32 = parts[2].parse().ok()?;
    NaiveDate::from_ymd_opt(y, m, d)
}

pub fn parse_hm(s: &str) -> Option<i64> {
    let (h, m) = s.split_once(':')?;
    let h: i64 = h.parse().ok()?;
    let m: i64 = m.parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 3600 + m * 60)
}

pub fn start_of_day(d: DateTime<Local>) -> NaiveDate {
    d.date_naive()
}

pub fn add_days(d: NaiveDate, n: i64) -> NaiveDate {
    d + ChronoDuration::days(n)
}

pub fn diff_days(a: NaiveDate, b: NaiveDate) -> i64 {
    (b - a).num_days()
}

pub fn monday_of(d: NaiveDate) -> NaiveDate {
    let wd = d.weekday().num_days_from_monday() as i64; // 0=周一 .. 6=周日
    d - ChronoDuration::days(wd)
}

fn days_in_month(y: i32, m: u32) -> i64 {
    // m 为 1 起始月份
    let first_next = NaiveDate::from_ymd_opt(if m == 12 { y + 1 } else { y }, if m == 12 { 1 } else { m + 1 }, 1)
        .unwrap();
    first_next.pred_opt().unwrap().day() as i64
}

fn seconds_of_day(dt: DateTime<Local>) -> f64 {
    dt.hour() as f64 * 3600.0
        + dt.minute() as f64 * 60.0
        + dt.second() as f64
        + dt.nanosecond() as f64 / 1e9
}

fn at(day: NaiveDate, sec: i64) -> DateTime<Local> {
    let h = sec / 3600;
    let m = (sec % 3600) / 60;
    let s = sec % 60;
    let naive = day
        .and_hms_opt(h as u32, m as u32, s as u32)
        .expect("invalid time");
    Local.from_local_datetime(&naive).unwrap()
}

/* ---------------- 设置归一化 ---------------- */

fn work_default_map() -> Map<String, Value> {
    json!({
        "restMode": "double",
        "customRestDays": [0, 6],
        "bigSmallAnchor": null,
        "workStart": "09:00",
        "workEnd": "18:00",
        "lunchEnabled": true,
        "lunchStart": "12:00",
        "lunchEnd": "13:00",
        "monthlySalary": 10000,
        "payDaysMode": "legal",
        "customPayDays": 22,
        "payday": 10,
        "specialDates": {}
    })
    .as_object()
    .unwrap()
    .clone()
}

fn num_or_zero(v: Option<&Value>) -> f64 {
    v.and_then(|x| x.as_f64()).unwrap_or(0.0)
}

fn clamp_int(v: Option<&Value>, min: i64, max: i64, fallback: i64) -> i64 {
    let n = v.and_then(|x| x.as_f64()).map(|f| f.round() as i64);
    match n {
        Some(n) => n.clamp(min, max),
        None => fallback,
    }
}

pub fn normalize(raw: &Value) -> Work {
    let mut map = work_default_map();
    if let Value::Object(m) = raw {
        for (k, v) in m {
            map.insert(k.clone(), v.clone());
        }
    }

    // customRestDays：去重、过滤 0-6，非法则回退默认
    match map.get("customRestDays").and_then(|v| v.as_array()) {
        Some(arr) => {
            let mut seen = HashSet::new();
            let mut out = Vec::new();
            for d in arr {
                if let Some(n) = d.as_i64() {
                    if n >= 0 && n <= 6 && seen.insert(n) {
                        out.push(n);
                    }
                }
            }
            map.insert("customRestDays".into(), json!(out));
        }
        None => {
            map.insert("customRestDays".into(), json!([0, 6]));
        }
    }

    // specialDates
    if !map.get("specialDates").map(|v| v.is_object()).unwrap_or(false) {
        map.insert("specialDates".into(), json!({}));
    }

    // 数值字段
    let salary = num_or_zero(map.get("monthlySalary")).max(0.0);
    map.insert("monthlySalary".into(), json!(salary));
    map.insert("customPayDays".into(), json!(num_or_zero(map.get("customPayDays"))));
    map.insert("payday".into(), json!(clamp_int(map.get("payday"), 1, 31, 10)));
    map.insert("lunchEnabled".into(), json!(map.get("lunchEnabled").and_then(|v| v.as_bool()).unwrap_or(false)));

    // 枚举校验
    let rm = map.get("restMode").and_then(|v| v.as_str()).unwrap_or("");
    if !["double", "single", "bigsmall", "custom"].contains(&rm) {
        map.insert("restMode".into(), json!("double"));
    }
    let pm = map.get("payDaysMode").and_then(|v| v.as_str()).unwrap_or("");
    if !["legal", "actual", "custom"].contains(&pm) {
        map.insert("payDaysMode".into(), json!("legal"));
    }

    // 大小周锚点
    let is_bigsmall = map.get("restMode").and_then(|v| v.as_str()) == Some("bigsmall");
    if is_bigsmall {
        let anchor_valid = map
            .get("bigSmallAnchor")
            .and_then(|v| v.as_str())
            .map(|s| parse_date_key(s).is_some())
            .unwrap_or(false);
        if !anchor_valid {
            let anchor = date_key(monday_of(Local::now().date_naive()));
            map.insert("bigSmallAnchor".into(), json!(anchor));
        }
    }

    serde_json::from_value(Value::Object(map)).expect("normalized work must deserialize")
}

impl Work {
    pub fn defaults() -> Work {
        normalize(&Value::Null)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationError {
    pub field: String,
    pub msg: String,
}

fn err(field: &str, msg: &str) -> ValidationError {
    ValidationError {
        field: field.into(),
        msg: msg.into(),
    }
}

pub fn validate(s: &Work) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let start = parse_hm(&s.work_start);
    let end = parse_hm(&s.work_end);
    if start.is_none() {
        errors.push(err("workStart", "请填写上班时间"));
    }
    if end.is_none() {
        errors.push(err("workEnd", "请填写下班时间"));
    }
    if let (Some(st), Some(en)) = (start, end) {
        if en <= st {
            errors.push(err("workEnd", "下班时间需要晚于上班时间（暂不支持跨天夜班）"));
        }
    }
    if s.lunch_enabled {
        let ls = parse_hm(&s.lunch_start);
        let le = parse_hm(&s.lunch_end);
        if ls.is_none() || le.is_none() {
            errors.push(err("lunchEnd", "请填写完整的午休时间"));
        } else if let (Some(a), Some(b)) = (ls, le) {
            if b <= a {
                errors.push(err("lunchEnd", "午休结束需要晚于午休开始"));
            } else if let (Some(st), Some(en)) = (start, end) {
                if en > st && b - a >= en - st {
                    errors.push(err("lunchEnd", "午休时长不能覆盖整个工作时间"));
                }
            }
        }
    }
    if !(s.monthly_salary > 0.0) {
        errors.push(err("monthlySalary", "请填写大于 0 的月薪"));
    }
    if s.pay_days_mode == "custom" {
        let d = s.custom_pay_days;
        if !(d > 0.0 && d <= 31.0) {
            errors.push(err("customPayDays", "计薪天数需在 1 ~ 31 之间"));
        }
    }
    if !(s.payday >= 1 && s.payday <= 31) {
        errors.push(err("payday", "发薪日需在 1 ~ 31 号之间"));
    }
    if s.rest_mode == "custom" && s.custom_rest_days.len() >= 7 {
        errors.push(err("customRestDays", "至少保留一个工作日"));
    }
    errors
}

/* ---------------- 休息日 / 工作日 ---------------- */

fn is_double_rest_week(date: NaiveDate, s: &Work) -> bool {
    let anchor = parse_date_key(s.big_small_anchor.as_deref().unwrap_or(""))
        .unwrap_or_else(|| monday_of(Local::now().date_naive()));
    let weeks = (diff_days(monday_of(anchor), monday_of(date)) as f64 / 7.0).round() as i64;
    ((weeks % 2) + 2) % 2 == 0
}

pub fn is_rest_day(date: NaiveDate, s: &Work) -> bool {
    if let Some(sp) = s.special_dates.get(&date_key(date)) {
        if sp == "rest" {
            return true;
        }
        if sp == "work" {
            return false;
        }
    }
    let wd = date.weekday().num_days_from_sunday() as i64; // 0=周日 .. 6=周六
    match s.rest_mode.as_str() {
        "single" => wd == 0,
        "custom" => s.custom_rest_days.contains(&wd),
        "bigsmall" => {
            if wd == 0 {
                return true;
            }
            if wd != 6 {
                return false;
            }
            is_double_rest_week(date, s)
        }
        _ => wd == 0 || wd == 6,
    }
}

pub fn workdays_in_month(s: &Work, y: i32, m: u32) -> i64 {
    let total = days_in_month(y, m);
    let mut n = 0;
    for d in 1..=total {
        let date = NaiveDate::from_ymd_opt(y, m, d as u32).unwrap();
        if !is_rest_day(date, s) {
            n += 1;
        }
    }
    n
}

/* ---------------- 工时 / 薪资 ---------------- */

#[derive(Debug, Clone)]
pub struct Schedule {
    pub valid: bool,
    pub start: i64,
    pub end: i64,
    pub lunch: Option<(i64, i64)>,
    pub work_seconds: i64,
}

fn schedule(s: &Work) -> Schedule {
    let start = match parse_hm(&s.work_start) {
        Some(v) => v,
        None => {
            return Schedule {
                valid: false,
                start: 0,
                end: 0,
                lunch: None,
                work_seconds: 0,
            }
        }
    };
    let end = match parse_hm(&s.work_end) {
        Some(v) => v,
        None => {
            return Schedule {
                valid: false,
                start,
                end: 0,
                lunch: None,
                work_seconds: 0,
            }
        }
    };
    if end <= start {
        return Schedule {
            valid: false,
            start,
            end,
            lunch: None,
            work_seconds: 0,
        };
    }
    let mut lunch = None;
    if s.lunch_enabled {
        if let (Some(ls), Some(le)) = (parse_hm(&s.lunch_start), parse_hm(&s.lunch_end)) {
            if le > ls {
                let a = ls.max(start);
                let b = le.min(end);
                if b > a {
                    lunch = Some((a, b));
                }
            }
        }
    }
    let work_seconds = end - start - lunch.map(|(a, b)| b - a).unwrap_or(0);
    Schedule {
        valid: work_seconds > 0,
        start,
        end,
        lunch,
        work_seconds,
    }
}

fn worked_at(sch: &Schedule, t: f64) -> f64 {
    let c = t.clamp(sch.start as f64, sch.end as f64);
    let mut w = c - sch.start as f64;
    if let Some((ls, le)) = sch.lunch {
        w -= (c.min(le as f64) - ls as f64).max(0.0);
    }
    w.max(0.0)
}

fn pay_days_for(s: &Work, ref_date: NaiveDate) -> f64 {
    if s.pay_days_mode == "custom" {
        return if s.custom_pay_days > 0.0 {
            s.custom_pay_days
        } else {
            LEGAL_PAY_DAYS
        };
    }
    if s.pay_days_mode == "actual" {
        let n = workdays_in_month(s, ref_date.year(), ref_date.month());
        return if n > 0 { n as f64 } else { LEGAL_PAY_DAYS };
    }
    LEGAL_PAY_DAYS
}

#[derive(Debug, Clone)]
pub struct Rates {
    pub sch: Schedule,
    pub pay_days: f64,
    pub daily: f64,
    pub hours: f64,
    pub hourly: f64,
    pub per_second: f64,
}

fn rates(s: &Work, ref_date: NaiveDate) -> Rates {
    let sch = schedule(s);
    let pay_days = pay_days_for(s, ref_date);
    let daily = if s.monthly_salary > 0.0 {
        s.monthly_salary / pay_days
    } else {
        0.0
    };
    let hours = if sch.valid {
        sch.work_seconds as f64 / 3600.0
    } else {
        0.0
    };
    let hourly = if hours > 0.0 { daily / hours } else { 0.0 };
    let per_second = if sch.valid {
        daily / sch.work_seconds as f64
    } else {
        0.0
    };
    Rates {
        sch,
        pay_days,
        daily,
        hours,
        hourly,
        per_second,
    }
}

fn days_to_rest(s: &Work, today: NaiveDate) -> Option<i64> {
    if is_rest_day(today, s) {
        return Some(0);
    }
    for i in 1..=400 {
        if is_rest_day(add_days(today, i), s) {
            return Some(i);
        }
    }
    None
}

fn next_payday(s: &Work, today: NaiveDate) -> Option<NaiveDate> {
    for k in 0..3 {
        let y0 = today.year();
        let m0 = today.month0() as i64 + k; // 0 起始月份 + k，可能溢出到次年
        let yy = y0 + (m0 / 12) as i32;
        let mm0 = (m0 % 12) as u32; // 0 起始
        let dim = days_in_month(yy, mm0 + 1);
        let day = s.payday.min(dim) as u32;
        let d = NaiveDate::from_ymd_opt(yy, mm0 + 1, day).unwrap();
        if d >= today {
            return Some(d);
        }
    }
    None
}

fn next_work_start(s: &Work, now: DateTime<Local>, sch: &Schedule) -> Option<DateTime<Local>> {
    for i in 0..=400 {
        let day = add_days(now.date_naive(), i);
        if is_rest_day(day, s) {
            continue;
        }
        let t = at(day, sch.start);
        if t > now {
            return Some(t);
        }
    }
    None
}

fn palette_for(now: DateTime<Local>) -> &'static str {
    let m = now.hour() as i64 * 60 + now.minute() as i64;
    if m < 330 {
        "night"
    } else if m < 450 {
        "dawn"
    } else if m < 1020 {
        "day"
    } else if m < 1170 {
        "sunset"
    } else {
        "night"
    }
}

fn mood_for(status: &str, now: DateTime<Local>) -> &'static str {
    let h = now.hour();
    let late_night = h >= 23 || h < 6;
    if status == "lunch" {
        return "sleep";
    }
    if late_night && status != "working" {
        return "sleep";
    }
    if status == "off" || status == "rest" {
        return "happy";
    }
    "lazy"
}

/* ---------------- 快照 ---------------- */

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub status: String,
    pub countdown: f64,
    pub progress: f64,
    pub earned: f64,
    pub worked: f64,
    pub daily: f64,
    pub hourly: f64,
    pub per_second: f64,
    pub pay_days: f64,
    pub is_rest_day: bool,
    pub days_to_rest: Option<i64>,
    pub days_to_payday: Option<i64>,
    pub palette: &'static str,
    pub mood: &'static str,
    pub lunch_left: f64,
    pub next_payday: Option<NaiveDate>,
    pub sch: Schedule,
}

pub fn snapshot(s: &Work, now: DateTime<Local>) -> Snapshot {
    let today = now.date_naive();
    let r = rates(s, today);
    let sch = r.sch;
    let t = seconds_of_day(now);
    let payday = next_payday(s, today);

    let is_rest = is_rest_day(today, s);

    let mut status = "invalid".to_string();
    let mut countdown = 0.0f64;
    let mut progress = 0.0f64;
    let mut earned = 0.0f64;
    let mut worked = 0.0f64;
    let mut lunch_left = 0.0f64;

    if sch.valid {
        if is_rest {
            status = "rest".to_string();
        } else if t < sch.start as f64 {
            status = "before".to_string();
            countdown = sch.start as f64 - t;
        } else if t >= sch.end as f64 {
            status = "off".to_string();
            progress = 1.0;
            worked = sch.work_seconds as f64;
            earned = r.daily;
        } else {
            worked = worked_at(&sch, t);
            progress = worked / sch.work_seconds as f64;
            earned = worked * r.per_second;
            countdown = sch.end as f64 - t;
            if let Some((ls, le)) = sch.lunch {
                if t >= ls as f64 && t < le as f64 {
                    status = "lunch".to_string();
                    lunch_left = le as f64 - t;
                } else {
                    status = "working".to_string();
                }
            } else {
                status = "working".to_string();
            }
        }
        if status == "rest" || status == "off" {
            let nw = next_work_start(s, now, &sch);
            countdown = nw
                .map(|n| (n - now).num_milliseconds() as f64 / 1000.0)
                .unwrap_or(0.0);
        }
    }

    let palette = palette_for(now);
    let mood = mood_for(&status, now);

    Snapshot {
        status,
        countdown,
        progress,
        earned,
        worked,
        daily: r.daily,
        hourly: r.hourly,
        per_second: r.per_second,
        pay_days: r.pay_days,
        is_rest_day: is_rest,
        days_to_rest: days_to_rest(s, today),
        days_to_payday: payday.map(|p| diff_days(today, p)),
        palette,
        mood,
        lunch_left,
        next_payday: payday,
        sch,
    }
}

/* ---------------- 描述 ---------------- */

#[derive(Debug, Clone, PartialEq)]
pub struct Describe {
    pub title: String,
    pub short: String,
    pub big: String,
    pub badge: String,
    pub tray: String,
}

pub fn describe(snap: &Snapshot) -> Describe {
    let cd = format_countdown(snap.countdown);
    let night = snap.mood == "sleep" && snap.status != "lunch";
    match snap.status.as_str() {
        "working" => Describe {
            title: "距离下班还有".into(),
            short: "距离下班".into(),
            big: cd.clone(),
            badge: "摸鱼中…".into(),
            tray: cd,
        },
        "lunch" => Describe {
            title: "午休中 · 距离下班还有".into(),
            short: "午休中 · 距离下班".into(),
            big: cd.clone(),
            badge: "午休打盹 Zzz".into(),
            tray: format!("午休 {}", cd),
        },
        "before" => Describe {
            title: "距离上班还有".into(),
            short: "距离上班".into(),
            big: cd.clone(),
            badge: if night { "晚安 Zzz".into() } else { "还没上班".into() },
            tray: format!("上班 {}", cd),
        },
        "off" => Describe {
            title: "今日已下班".into(),
            short: "已下班".into(),
            big: "下班啦！".into(),
            badge: if night { "晚安 Zzz".into() } else { "下班啦！".into() },
            tray: "已下班".into(),
        },
        "rest" => Describe {
            title: "休息日 · 距离上班还有".into(),
            short: "休息日".into(),
            big: cd,
            badge: if night { "晚安 Zzz".into() } else { "休息日".into() },
            tray: "休息日".into(),
        },
        _ => Describe {
            title: "请先完善工作时间".into(),
            short: "待设置".into(),
            big: "--:--:--".into(),
            badge: "等待设置".into(),
            tray: "摸鱼小狐".into(),
        },
    }
}

/* ---------------- 格式化 ---------------- */

pub fn format_hms(sec: f64) -> String {
    let sec = sec.max(0.0).floor() as i64;
    format!(
        "{:02}:{:02}:{:02}",
        sec / 3600,
        (sec % 3600) / 60,
        sec % 60
    )
}

pub fn format_countdown(sec: f64) -> String {
    let sec = sec.max(0.0).floor() as i64;
    if sec < 86400 {
        return format_hms(sec as f64);
    }
    format!("{}天 {}", sec / 86400, format_hms((sec % 86400) as f64))
}

pub fn format_clock(sec: f64) -> String {
    let sec = sec.max(0.0).floor() as i64;
    format!("{:02}:{:02}", sec / 3600, (sec % 3600) / 60)
}

pub fn format_duration(sec: f64) -> String {
    let sec = sec.max(0.0).floor() as i64;
    let h = sec / 3600;
    let m = (sec % 3600) / 60;
    if h != 0 && m != 0 {
        format!("{} 小时 {} 分", h, m)
    } else if h != 0 {
        format!("{} 小时", h)
    } else {
        format!("{} 分钟", m)
    }
}

pub fn format_money(n: f64, digits: u32) -> String {
    let f = 10f64.powi(digits as i32);
    let scaled = ((n.max(0.0)) * f + 1e-6).floor() as i64;
    let int_part = scaled / (f as i64);
    let frac_part = scaled % (f as i64);
    let int_str = group_thousands(int_part);
    if digits == 0 {
        int_str
    } else {
        format!("{}.{:0width$}", int_str, frac_part, width = digits as usize)
    }
}

fn group_thousands(n: i64) -> String {
    let s = n.to_string();
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut out = String::new();
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            out.push(',');
        }
        out.push(*b as char);
    }
    out
}

/// 托盘 tooltip 的状态行（对应 main.js 的 statusLine）
pub fn status_line(snap: &Snapshot, d: &Describe) -> String {
    let earned = if snap.status == "rest" {
        String::new()
    } else {
        format!(" · 今日 ¥{}", format_money(snap.earned, 2))
    };
    if snap.status == "off" || snap.status == "invalid" {
        format!("{}{}", d.title, earned)
    } else {
        format!("{} {}{}", d.short, d.big, earned)
    }
}

pub fn relative_day(date: NaiveDate, now: NaiveDate) -> String {
    let d = diff_days(now, date);
    if d == 0 {
        return "今天".into();
    }
    if d == 1 {
        return "明天".into();
    }
    if d == 2 {
        return "后天".into();
    }
    format!(
        "{}月{}日 {}",
        date.month(),
        date.day(),
        WEEK_NAMES[date.weekday().num_days_from_sunday() as usize]
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Local, TimeZone};
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Case {
        name: String,
        now: [i32; 6],
        status: String,
        countdown: i64,
        title: String,
        short: String,
        big: String,
        badge: String,
        tray: String,
        earned: String,
        daily: String,
        #[serde(rename = "daysToRest")]
        days_to_rest: Option<i64>,
        #[serde(rename = "daysToPayday")]
        days_to_payday: Option<i64>,
    }

    fn dt(a: [i32; 6]) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(a[0], a[1] as u32, a[2] as u32, a[3] as u32, a[4] as u32, a[5] as u32)
            .unwrap()
    }

    #[test]
    fn core_matches_js_fixture() {
        // 夹具由 scripts/gen-core-fixture.js 以 core.js 为金标准生成。
        // 注意：跨天倒计时（off/rest 用例）依赖本机时区，夹具与测试应在同一台机器上运行。
        let data = include_str!("../tests/fixtures/core.json");
        let cases: Vec<Case> = serde_json::from_str(data).unwrap();
        assert!(!cases.is_empty());

        let work = Work::defaults();
        for c in &cases {
            let snap = snapshot(&work, dt(c.now));
            let d = describe(&snap);
            assert_eq!(snap.status, c.status, "[{}] status", c.name);
            assert_eq!(snap.countdown.floor() as i64, c.countdown, "[{}] countdown", c.name);
            assert_eq!(d.title, c.title, "[{}] title", c.name);
            assert_eq!(d.short, c.short, "[{}] short", c.name);
            assert_eq!(d.big, c.big, "[{}] big", c.name);
            assert_eq!(d.badge, c.badge, "[{}] badge", c.name);
            assert_eq!(d.tray, c.tray, "[{}] tray", c.name);
            assert_eq!(format_money(snap.earned, 2), c.earned, "[{}] earned", c.name);
            assert_eq!(format_money(snap.daily, 2), c.daily, "[{}] daily", c.name);
            assert_eq!(snap.days_to_rest, c.days_to_rest, "[{}] daysToRest", c.name);
            assert_eq!(snap.days_to_payday, c.days_to_payday, "[{}] daysToPayday", c.name);
        }
    }
}
