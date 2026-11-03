/* 摸鱼小狐 · 手绘 SVG 场景 */
(function (root) {
  'use strict';

  const QUOTES = {
    working: [
      '带薪摸鱼，快乐加倍~',
      '鱼还没上钩，工资先到账',
      '老板看不见我，看不见我…',
      '每一秒都在赚钱哦',
      '再坚持一下下就下班啦',
      '摸鱼也是一种生产力',
    ],
    lunch: ['Zzz…午休时间别吵我', '吃饱了就想睡…', '午觉是打工狐的权利'],
    before: ['还没上班，再躺会儿', '今天也要元气满满地摸鱼', '早起的狐狸有鱼吃？'],
    off: ['下班啦！钓鱼去咯', '今天的工资已到手', '冲鸭，下班自由啦！'],
    rest: ['休息日！全天钓鱼', '今天不上班，真好', '周末的湖水格外清澈'],
    sleep: ['Zzz…', '夜深了，早点休息哦', '梦里也在钓鱼…'],
    invalid: ['先把工作时间设置好吧~'],
  };

  function svgMarkup(uid) {
    const g = (n) => `${n}-${uid}`;
    return `
<svg class="scene-svg" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${g('sky')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="sky-top"/><stop offset="1" class="sky-bottom"/>
    </linearGradient>
    <linearGradient id="${g('water')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="water-top"/><stop offset="1" class="water-bottom"/>
    </linearGradient>
    <linearGradient id="${g('log')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#B57A4A"/><stop offset=".55" stop-color="#8C5530"/><stop offset="1" stop-color="#5E3519"/>
    </linearGradient>
    <linearGradient id="${g('fur')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FF9A45"/><stop offset="1" stop-color="#EE6A1F"/>
    </linearGradient>
    <linearGradient id="${g('tail')}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#E9621B"/><stop offset="1" stop-color="#FF9C4A"/>
    </linearGradient>
    <linearGradient id="${g('bucket')}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8E9AA6"/><stop offset=".45" stop-color="#E3E9EE"/><stop offset="1" stop-color="#7E8A96"/>
    </linearGradient>
    <radialGradient id="${g('sun')}" cx=".5" cy=".5" r=".5">
      <stop offset="0" class="sun-core"/><stop offset=".55" class="sun-mid"/><stop offset="1" class="sun-edge" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${g('shine')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="${g('lake')}"><rect x="0" y="262" width="800" height="238"/></clipPath>
  </defs>

  <!-- 天空 -->
  <rect width="800" height="500" fill="url(#${g('sky')})"/>
  <g class="stars">
    <circle cx="60" cy="40" r="1.6"/><circle cx="130" cy="95" r="1.2"/><circle cx="210" cy="30" r="1.8"/>
    <circle cx="300" cy="70" r="1.1"/><circle cx="360" cy="24" r="1.5"/><circle cx="470" cy="55" r="1.3"/>
    <circle cx="540" cy="22" r="1.7"/><circle cx="720" cy="40" r="1.4"/><circle cx="770" cy="110" r="1.2"/>
    <circle cx="90" cy="150" r="1"/><circle cx="420" cy="120" r="1"/><circle cx="600" cy="150" r="1.1"/>
  </g>
  <g class="sun">
    <circle cx="640" cy="92" r="70" fill="url(#${g('sun')})"/>
    <circle class="sun-disc" cx="640" cy="92" r="30"/>
  </g>
  <g class="moon">
    <circle cx="640" cy="88" r="46" fill="#FFF6D8" opacity=".12"/>
    <path d="M646 62.7 A26 26 0 1 0 664.6 96.5 A22 22 0 0 1 646 62.7 Z" fill="#FFF6D8"/>
  </g>

  <!-- 云 -->
  <g class="clouds">
    <g class="cloud c1">
      <path d="M40 118 q8 -26 36 -22 q12 -24 42 -14 q26 -8 34 18 q24 2 20 22 h-138 q-12 -2 6 -4z"/>
    </g>
    <g class="cloud c2">
      <path d="M300 70 q10 -20 32 -16 q14 -20 40 -8 q22 -4 26 18 q18 4 12 18 h-120 q-8 -6 10 -12z"/>
    </g>
    <g class="cloud c3">
      <path d="M520 160 q10 -22 34 -18 q14 -22 44 -10 q26 -6 30 20 q22 4 16 22 h-138 q-10 -6 14 -14z"/>
    </g>
  </g>

  <!-- 远山 -->
  <path class="mtn-far" d="M0 232 L70 196 L130 214 L210 168 L290 210 L360 186 L430 220 L520 176 L600 206 L680 180 L760 210 L800 200 V270 H0Z"/>
  <path class="mtn-near" d="M0 252 Q60 228 120 244 T250 240 T380 248 T520 236 T660 246 T800 238 V272 H0Z"/>
  <g class="treeline">
    <path d="M30 252 l10 -28 l10 28z M52 254 l8 -22 l8 22z M700 248 l10 -30 l10 30z M724 250 l8 -22 l8 22z M748 252 l9 -26 l9 26z"/>
  </g>

  <!-- 湖面 -->
  <rect x="0" y="262" width="800" height="238" fill="url(#${g('water')})"/>
  <rect x="0" y="262" width="800" height="60" fill="url(#${g('shine')})" opacity=".35"/>
  <g clip-path="url(#${g('lake')})">
    <g class="reflection">
      <ellipse cx="640" cy="300" rx="16" ry="4"/><ellipse cx="640" cy="316" rx="26" ry="3"/><ellipse cx="640" cy="334" rx="12" ry="2.5"/>
    </g>
    <g class="shimmer">
      <path d="M40 300 h60 M150 330 h40 M560 292 h70 M690 340 h50 M80 420 h50 M620 440 h80 M300 300 h36 M240 470 h60"/>
    </g>
  </g>

  <!-- 浮萍 -->
  <g class="lily">
    <path d="M90 432 a34 12 0 1 0 1 0 l-14 10z" fill="#6DB56A"/>
    <path d="M90 432 a34 12 0 1 0 1 0" fill="none" stroke="#4F9850" stroke-width="2"/>
    <path d="M640 470 a30 10 0 1 0 1 0 l-12 8z" fill="#74BC6E"/>
    <path d="M700 420 a22 8 0 1 0 1 0 l-9 6z" fill="#6DB56A"/>
    <circle cx="655" cy="463" r="5" fill="#F7B6C8"/><circle cx="655" cy="463" r="2" fill="#FFE27A"/>
  </g>

  <!-- 浮漂与鱼线 -->
  <g class="bobber-wrap">
    <ellipse class="ripple r1" cx="178" cy="398" rx="16" ry="4"/>
    <ellipse class="ripple r2" cx="178" cy="398" rx="16" ry="4"/>
    <g class="bobber">
      <path d="M178 381 a9 9 0 0 1 9 9 h-18 a9 9 0 0 1 9 -9z" fill="#F0483E"/>
      <path d="M169 390 h18 a9 8 0 0 1 -18 0z" fill="#FFFFFF"/>
      <rect x="176.5" y="374" width="3" height="8" rx="1.5" fill="#2E2A2A"/>
    </g>
  </g>
  <path class="fishing-line" d="M166 118 Q170 260 178 376" fill="none"/>

  <!-- 水下的鱼 -->
  <g class="fish-swim">
    <g class="fish">
      <path d="M150 452 q34 -26 72 0 q-38 26 -72 0z" fill="#5C9FD6"/>
      <path d="M150 452 l-20 -14 l4 14 l-4 14z" fill="#4A88C0"/>
      <path d="M176 440 q16 -12 30 2" fill="none" stroke="#9CCBF0" stroke-width="3" stroke-linecap="round"/>
      <circle cx="206" cy="448" r="4" fill="#fff"/><circle cx="207" cy="448" r="2" fill="#1E2A3A"/>
    </g>
  </g>

  <!-- 木筏 -->
  <g class="raft">
    <ellipse cx="400" cy="392" rx="190" ry="16" class="raft-shadow"/>
    <rect x="236" y="318" width="318" height="38" rx="19" fill="url(#${g('log')})"/>
    <rect x="236" y="318" width="318" height="38" rx="19" fill="none" stroke="#4E2C14" stroke-width="2"/>
    <path d="M262 330 h120 M410 340 h110" stroke="#6E4122" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="548" cy="337" rx="14" ry="19" fill="#E2B27E" stroke="#8C5530" stroke-width="3"/>
    <ellipse cx="548" cy="337" rx="8" ry="11" fill="none" stroke="#B9834F" stroke-width="2"/>
    <ellipse cx="548" cy="337" rx="3" ry="4" fill="#B9834F"/>
    <rect x="222" y="348" width="330" height="42" rx="21" fill="url(#${g('log')})"/>
    <rect x="222" y="348" width="330" height="42" rx="21" fill="none" stroke="#4E2C14" stroke-width="2"/>
    <path d="M250 364 h90 M370 372 h140" stroke="#6E4122" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="546" cy="369" rx="15" ry="21" fill="#E8BB88" stroke="#8C5530" stroke-width="3"/>
    <ellipse cx="546" cy="369" rx="9" ry="12" fill="none" stroke="#B9834F" stroke-width="2"/>
    <ellipse cx="546" cy="369" rx="3.5" ry="4.5" fill="#B9834F"/>
    <path class="waterline" d="M210 384 q30 8 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 v18 h-360z"/>
  </g>

  <!-- 鱼桶 -->
  <g class="bucket">
    <path d="M488 270 q-6 -32 14 -34" fill="none" stroke="#6E7A86" stroke-width="3"/>
    <path d="M478 274 h62 l-7 52 h-48z" fill="url(#${g('bucket')})" stroke="#5E6A76" stroke-width="2"/>
    <ellipse cx="509" cy="274" rx="31" ry="7" fill="#4C6A86"/>
    <path d="M478 288 h62" stroke="#6E7A86" stroke-width="2"/>
    <g class="bucket-fish">
      <path d="M500 270 q8 -26 22 -30 q-4 14 -2 30z" fill="#6AA7DB"/>
      <path d="M522 240 l8 -10 l-1 12z M522 240 l-10 -8 l4 10z" fill="#4A88C0"/>
      <circle cx="508" cy="262" r="2.4" fill="#1E2A3A"/>
    </g>
  </g>

  <!-- 狐狸 -->
  <g class="fox">
    <!-- 尾巴 -->
    <g class="tail">
      <path d="M450 322 C500 336 560 330 590 300 C612 276 598 246 572 242 C580 268 566 290 540 298 C512 306 482 300 456 292 Z" fill="url(#${g('tail')})"/>
      <path d="M572 242 C600 246 614 274 594 298 C584 310 572 316 560 318 C578 300 588 280 578 258 Z" fill="#FFF6EA"/>
      <path d="M470 306 q30 6 60 -2" fill="none" stroke="#D9561A" stroke-width="2" stroke-linecap="round" opacity=".6"/>
    </g>

    <!-- 身体 -->
    <path d="M338 336 C330 282 350 246 400 244 C452 246 470 284 462 336 C440 352 360 352 338 336 Z" fill="url(#${g('fur')})"/>
    <path d="M372 262 C384 256 416 256 428 262 C436 290 430 320 400 330 C370 320 364 290 372 262 Z" fill="#FFF6EA"/>
    <!-- 后腿 -->
    <ellipse cx="438" cy="334" rx="30" ry="18" fill="#EE6A1F"/>
    <path d="M356 340 C340 346 318 350 300 344 C292 340 294 330 302 328 C320 326 340 328 352 326 Z" fill="#5A3A2E"/>
    <path d="M410 346 C396 354 372 360 354 356 C346 352 348 342 356 340 C372 338 392 338 404 336 Z" fill="#5A3A2E"/>
    <!-- 手臂 + 鱼竿 -->
    <path class="rod" d="M352 300 L166 118" fill="none"/>
    <circle cx="340" cy="290" r="6" fill="#3D3D45"/><circle cx="340" cy="290" r="2.5" fill="#9AA3AD"/>
    <path d="M384 270 C370 276 356 286 350 296 C346 304 356 310 364 304 C374 296 386 288 394 282 Z" fill="#EE6A1F"/>
    <ellipse cx="352" cy="300" rx="11" ry="9" fill="#5A3A2E"/>
    <path d="M440 284 C452 298 450 318 436 326 C428 330 420 324 424 316 C430 306 432 296 430 288 Z" fill="#F07A2C"/>

    <!-- 头 -->
    <g class="head">
      <g class="ear ear-l">
        <path d="M352 176 L330 104 C348 112 372 132 388 160 Z" fill="#EE6A1F"/>
        <path d="M352 166 L340 122 C352 130 364 142 374 160 Z" fill="#4A2C24"/>
        <path d="M330 104 L336 124 L346 116 Z" fill="#3A2420"/>
      </g>
      <g class="ear ear-r">
        <path d="M448 176 L470 104 C452 112 428 132 412 160 Z" fill="#EE6A1F"/>
        <path d="M448 166 L460 122 C448 130 436 142 426 160 Z" fill="#4A2C24"/>
        <path d="M470 104 L464 124 L454 116 Z" fill="#3A2420"/>
      </g>
      <path d="M336 206 C334 160 364 140 400 140 C436 140 466 160 464 206 C476 214 474 226 462 230 C446 254 424 262 400 262 C376 262 354 254 338 230 C326 226 324 214 336 206 Z" fill="url(#${g('fur')})"/>
      <path d="M340 216 C356 208 380 212 400 230 C420 212 444 208 460 216 C454 244 430 260 400 260 C370 260 346 244 340 216 Z" fill="#FFF6EA"/>
      <path d="M392 150 q8 10 16 0" fill="none" stroke="#D9561A" stroke-width="2" stroke-linecap="round" opacity=".7"/>
      <ellipse class="blush" cx="358" cy="228" rx="11" ry="6"/>
      <ellipse class="blush" cx="442" cy="228" rx="11" ry="6"/>

      <!-- 眼睛：按心情切换 -->
      <g class="eyes eyes-lazy">
        <path d="M362 204 a13 11 0 0 0 26 0 z" fill="#2B1E1E"/>
        <path d="M360 203 h30" stroke="#B9501A" stroke-width="3" stroke-linecap="round"/>
        <circle cx="381" cy="207" r="2" fill="#fff"/>
        <path d="M412 204 a13 11 0 0 0 26 0 z" fill="#2B1E1E"/>
        <path d="M410 203 h30" stroke="#B9501A" stroke-width="3" stroke-linecap="round"/>
        <circle cx="431" cy="207" r="2" fill="#fff"/>
      </g>
      <g class="eyes eyes-happy">
        <path d="M364 208 q11 -14 22 0" fill="none" stroke="#2B1E1E" stroke-width="4" stroke-linecap="round"/>
        <path d="M414 208 q11 -14 22 0" fill="none" stroke="#2B1E1E" stroke-width="4" stroke-linecap="round"/>
      </g>
      <g class="eyes eyes-sleep">
        <path d="M364 204 q11 9 22 0" fill="none" stroke="#2B1E1E" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M414 204 q11 9 22 0" fill="none" stroke="#2B1E1E" stroke-width="3.5" stroke-linecap="round"/>
      </g>
      <g class="eyes eyes-wow">
        <ellipse cx="375" cy="204" rx="9" ry="11" fill="#2B1E1E"/><circle cx="378" cy="199" r="3.4" fill="#fff"/><circle cx="372" cy="208" r="1.6" fill="#fff"/>
        <ellipse cx="425" cy="204" rx="9" ry="11" fill="#2B1E1E"/><circle cx="428" cy="199" r="3.4" fill="#fff"/><circle cx="422" cy="208" r="1.6" fill="#fff"/>
      </g>

      <ellipse cx="400" cy="230" rx="7" ry="5" fill="#2B1E1E"/>
      <ellipse cx="398" cy="228" rx="2.2" ry="1.3" fill="#fff" opacity=".7"/>
      <g class="mouth mouth-calm"><path d="M392 239 q4 4 8 0 q4 4 8 0" fill="none" stroke="#2B1E1E" stroke-width="2.4" stroke-linecap="round"/></g>
      <g class="mouth mouth-open"><path d="M390 238 q10 14 20 0 z" fill="#B23A3A" stroke="#2B1E1E" stroke-width="2.2" stroke-linejoin="round"/></g>
    </g>

    <g class="zzz">
      <text x="468" y="150">z</text><text x="486" y="128">z</text><text x="506" y="104">Z</text>
    </g>
  </g>

  <!-- 前景芦苇 -->
  <g class="reeds">
    <g class="reed-l">
      <path d="M-4 500 C10 440 18 400 30 330 M14 500 C24 450 40 410 52 372 M30 500 C30 460 22 430 8 392 M44 500 C52 470 64 440 84 418" />
      <ellipse cx="30" cy="322" rx="5" ry="16" class="cattail"/>
      <ellipse cx="53" cy="364" rx="4.5" ry="14" class="cattail"/>
    </g>
    <g class="reed-r">
      <path d="M804 500 C790 440 780 400 770 340 M786 500 C776 456 762 420 748 392 M770 500 C770 466 778 436 792 400 M756 500 C748 472 734 448 714 430" />
      <ellipse cx="770" cy="332" rx="5" ry="16" class="cattail"/>
      <ellipse cx="747" cy="384" rx="4.5" ry="14" class="cattail"/>
    </g>
  </g>
  <g class="leaves">
    <path d="M800 0 C760 20 740 40 720 70 C750 60 770 46 800 40Z M800 30 C770 60 760 80 758 108 C778 92 792 72 800 60Z M690 0 C700 26 720 40 748 46 C740 24 720 8 690 0Z"/>
  </g>

  <!-- 夜间暗化 -->
  <rect class="tint" width="800" height="500"/>

  <!-- 跃出水面的鱼（点击触发） -->
  <g class="jump-fish">
    <g class="jf">
      <path d="M-26 0 q26 -20 52 0 q-26 20 -52 0z" fill="#F7A23B"/>
      <path d="M-26 0 l-16 -11 l3 11 l-3 11z" fill="#E5832A"/>
      <circle cx="14" cy="-3" r="3" fill="#1E2A3A"/>
    </g>
  </g>
  <g class="splash">
    <ellipse class="sp1" cx="0" cy="0" rx="20" ry="5"/>
    <ellipse class="sp2" cx="0" cy="0" rx="20" ry="5"/>
  </g>
  <g class="hearts"></g>
</svg>`;
  }

  let uidSeed = 0;

  class FoxScene {
    constructor(host, opts) {
      opts = opts || {};
      this.host = host;
      this.uid = 's' + ++uidSeed;
      this.status = 'working';
      this.mood = 'lazy';
      this.override = null;
      this.overrideTimer = null;
      this.bubbleTimer = null;
      this.lastQuote = '';
      this.host.classList.add('fox-scene');
      if (opts.static) this.host.classList.add('is-static');
      this.host.innerHTML = svgMarkup(this.uid) + (opts.static ? '' : '<div class="speech" aria-live="polite"></div>');
      this.svg = this.host.querySelector('svg');
      this.speech = this.host.querySelector('.speech');
      this.setPalette('day');
      this.setMood('lazy');
      if (opts.interactive !== false && !opts.static) this._bindInteraction();
    }

    setPalette(name) {
      if (this.svg.dataset.palette !== name) this.svg.dataset.palette = name;
    }

    setMood(mood) {
      this.mood = mood;
      this._applyMood();
    }

    setStatus(status) {
      this.status = status;
    }

    _applyMood() {
      const m = this.override || this.mood;
      if (this.svg.dataset.mood !== m) this.svg.dataset.mood = m;
    }

    _bindInteraction() {
      const fox = this.svg.querySelector('.fox');
      fox.addEventListener('click', (e) => {
        e.stopPropagation();
        this.poke();
      });
      this.svg.addEventListener('click', (e) => {
        const pt = this._toSvgPoint(e);
        if (pt && pt.y > 280) this.jump(pt.x);
      });
      this.svg.querySelector('.bucket').addEventListener('click', (e) => {
        e.stopPropagation();
        this.jump(300 + Math.random() * 300);
      });
    }

    _toSvgPoint(e) {
      const ctm = this.svg.getScreenCTM();
      if (!ctm) return null;
      const p = this.svg.createSVGPoint();
      p.x = e.clientX;
      p.y = e.clientY;
      return p.matrixTransform(ctm.inverse());
    }

    _setOverride(mood, ms) {
      clearTimeout(this.overrideTimer);
      this.override = mood;
      this._applyMood();
      this.overrideTimer = setTimeout(() => {
        this.override = null;
        this._applyMood();
      }, ms);
    }

    poke() {
      this._setOverride(Math.random() < 0.5 ? 'wow' : 'happy', 2200);
      const head = this.svg.querySelector('.head');
      head.classList.remove('bounce');
      void head.getBBox();
      head.classList.add('bounce');
      this._hearts();
      const key = this.mood === 'sleep' && this.status !== 'lunch' ? 'sleep' : this.status;
      this.say(this._pick(QUOTES[key] || QUOTES.working));
    }

    say(text, ms) {
      if (!this.speech) return;
      this.speech.textContent = text;
      this.speech.classList.add('show');
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = setTimeout(() => this.speech.classList.remove('show'), ms || 2600);
    }

    _pick(list) {
      if (list.length === 1) return list[0];
      let q;
      do q = list[Math.floor(Math.random() * list.length)];
      while (q === this.lastQuote);
      this.lastQuote = q;
      return q;
    }

    _hearts() {
      const layer = this.svg.querySelector('.hearts');
      for (let i = 0; i < 3; i++) {
        const h = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const x = 380 + Math.random() * 60;
        const y = 150 + Math.random() * 20;
        h.setAttribute('d', `M${x} ${y} c-6 -8 -18 -2 -12 8 l12 10 l12 -10 c6 -10 -6 -16 -12 -8z`);
        h.setAttribute('class', 'heart');
        h.style.animationDelay = i * 0.18 + 's';
        layer.appendChild(h);
        setTimeout(() => h.remove(), 1800);
      }
    }

    jump(x) {
      x = Math.max(80, Math.min(720, x || 300));
      const wrap = this.svg.querySelector('.jump-fish');
      const splash = this.svg.querySelector('.splash');
      if (wrap.classList.contains('go')) return;
      const dir = Math.random() < 0.5 ? 1 : -1;
      wrap.setAttribute('transform', `translate(${x} 430) scale(${dir} 1)`);
      splash.setAttribute('transform', `translate(${x} 430)`);
      wrap.classList.add('go');
      splash.classList.remove('go');
      void splash.getBBox();
      splash.classList.add('go');
      setTimeout(() => wrap.classList.remove('go'), 1300);
      if (this.speech && Math.random() < 0.5) this.say(this._pick(['有鱼！', '哇，好大一条', '这条留着当晚饭']), 1600);
    }
  }

  root.FoxScene = FoxScene;
})(window);
