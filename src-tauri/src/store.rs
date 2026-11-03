//! config.json 分区存储（store.js 的 Rust 复刻）
//!
//! - 读取时与默认值按分区合并，缺失分区自动补齐
//! - 不认识的分区原样保留
//! - 写入采用「临时文件 + rename」避免断电损坏

use std::fs;
use std::path::PathBuf;

use serde_json::{Map, Value};

fn shallow_merge(base: &Value, over: Option<Value>) -> Value {
    let mut m = base.as_object().cloned().unwrap_or_default();
    if let Some(Value::Object(o)) = over {
        for (k, v) in o {
            m.insert(k, v);
        }
    }
    Value::Object(m)
}

pub struct Store {
    file: PathBuf,
    data: Value,
    defaults: Value,
    #[allow(dead_code)] // 版本检测（checkVersion）阶段会用到
    pub existed: bool,
}

impl Store {
    pub fn new(file: PathBuf, defaults: Value) -> Self {
        let existed = file.exists();
        let mut s = Store {
            file,
            data: Value::Object(Map::new()),
            defaults,
            existed,
        };
        s.data = s.read();
        s
    }

    fn read(&self) -> Value {
        let mut raw: Map<String, Value> = match fs::read_to_string(&self.file) {
            Ok(txt) => match serde_json::from_str::<Value>(&txt) {
                Ok(v) => v.as_object().cloned().unwrap_or_default(),
                Err(_) => {
                    // 文件损坏：备份后按空处理
                    let _ = fs::copy(&self.file, format!("{}.broken", self.file.display()));
                    Map::new()
                }
            },
            Err(_) => Map::new(),
        };

        if let Value::Object(defaults) = &self.defaults {
            for (key, def) in defaults {
                let cur = raw.get(key).filter(|v| v.is_object()).cloned();
                raw.insert(key.clone(), shallow_merge(def, cur));
            }
        }
        Value::Object(raw)
    }

    pub fn get(&self, section: &str) -> Value {
        self.data.get(section).cloned().unwrap_or(Value::Null)
    }

    pub fn set(&mut self, section: &str, value: Value) {
        if let Value::Object(o) = &mut self.data {
            o.insert(section.into(), value);
        }
        self.flush();
    }

    pub fn patch(&mut self, section: &str, patch: Value) -> Value {
        let merged = shallow_merge(&self.get(section), Some(patch));
        self.set(section, merged.clone());
        merged
    }

    pub fn flush(&mut self) {
        if let Some(dir) = self.file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let tmp = self.file.with_extension("json.tmp");
        let txt = serde_json::to_string_pretty(&self.data).unwrap_or_else(|_| "{}".into());
        if fs::write(&tmp, txt).is_ok() {
            let _ = fs::rename(&tmp, &self.file);
        }
    }
}
