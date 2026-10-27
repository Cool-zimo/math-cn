/* ============================================================
   学情诊断 · 主逻辑
   ------------------------------------------------------------
   一屏一件事：选范围 → 答题 → 报告。
   诊断算法全部来自上游 engine.js（纯函数、有 89 项测试背书），
   这里只负责界面与流程。
   界面骨架对齐 GitHub Drive：侧边栏导航 + 单主区，移动端抽屉。
   ============================================================ */
(function () {
    'use strict';

    var E = window.DiagEngine;

    var SUBJ = {
        cnm: { name: '数学', sub: '小学到高中' },
        cnc: { name: '语文', sub: '小学一至六' },
        cne: { name: '英语', sub: '三年级到高中' },
        cnp: { name: '物理', sub: '初中到高中' }
    };
    var SUBJ_ORDER = ['cnm', 'cnc', 'cne', 'cnp'];

    var ST_NAME = { mastered: '已掌握', shaky: '不稳', weak: '薄弱', unknown: '未测' };
    var ST_CLS = { mastered: 'm', shaky: 's', weak: 'w', unknown: 'u' };
    var LIMIT = 12;

    var S = {
        graph: null, topics: null, deps: null,
        subj: null, grade: null, chap: null,
        session: null, item: null,
        answered: 0, shared: null
    };

    var $ = function (id) { return document.getElementById(id); };

    /* ---------------- 视图路由 ---------------- */
    var VIEWS = ['v-load', 'v-home', 'v-quiz', 'v-report', 'v-records', 'v-mind', 'v-account'];
    var CRUMB = {
        'v-home': '开始诊断', 'v-quiz': '诊断中', 'v-report': '学习报告',
        'v-records': '学情记录', 'v-mind': '思维导图', 'v-account': '账号'
    };
    var NAVV = { home: 'v-home', records: 'v-records', mind: 'v-mind', account: 'v-account' };

    function view(id) {
        VIEWS.forEach(function (v) { $(v).classList.toggle('on', v === id); });
        if (CRUMB[id]) $('crumb').textContent = CRUMB[id];
        var nav = null;
        Object.keys(NAVV).forEach(function (k) { if (NAVV[k] === id) nav = k; });
        // 答题和报告仍属于「开始诊断」这一节
        if (id === 'v-quiz' || id === 'v-report') nav = 'home';
        document.querySelectorAll('.nav-item').forEach(function (a) {
            a.classList.toggle('active', a.getAttribute('data-view') === nav);
        });
        var c = $('content');
        if (c) c.scrollTop = 0;
        window.scrollTo(0, 0);
    }

    /* ---------------- 侧边栏 ---------------- */
    function sbOpen(on) {
        $('sidebar').classList.toggle('open', on);
        $('overlay').classList.toggle('active', on);
    }
    function isMobile() { return window.matchMedia('(max-width: 768px)').matches; }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    var toastT;
    function toast(msg) {
        var t = $('toast');
        t.textContent = msg; t.classList.add('on');
        clearTimeout(toastT);
        toastT = setTimeout(function () { t.classList.remove('on'); }, 2400);
    }
    function subjOf(id) {
        var m = /^(cnm|cnc|cne|cnp)/.exec(id || '');
        return m ? m[1] : 'cnm';
    }
    function normChapter(c) {
        var a = String(c || '').split(/\s+/);
        if (a.length > 1 && /^[\d.]+$/.test(a[a.length - 1])) a.pop();
        return a.join(' ');
    }
    function gradeName(g) {
        var n = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
        if (g >= 1 && g <= 9) return n[g] + '年级';
        if (g === 10) return '高一';
        if (g === 11) return '高二';
        if (g === 12) return '高三';
        if (g >= 13) return '选修 ' + (g - 12);
        return 'G' + g;
    }

    /* ---------------- 学情记录（本地） ---------------- */
    var RK = 'mathcn_records_v1';
    var NK = 'mathcn_name_v1';
    var TK = 'mathcn_theme_v1';

    function loadRec() {
        try { return JSON.parse(localStorage.getItem(RK)) || []; } catch (e) { return []; }
    }
    function saveRec(a) { try { localStorage.setItem(RK, JSON.stringify(a)); } catch (e) {} }

    function recBadge() {
        var b = $('nav-badge-rec'), n = loadRec().length;
        if (!b) return;
        b.textContent = n > 99 ? '99+' : String(n);
        b.hidden = n === 0;
    }

    function renderRecords() {
        var list = loadRec();
        var box = $('rec-list');
        if (!list.length) {
            box.innerHTML = '<div class="empty">' +
                '<div style="margin-bottom:14px;color:var(--text-tertiary)">' +
                '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M4 20V11"></path><path d="M10 20V4"></path><path d="M16 20v-6"></path><path d="M21 20H3"></path></svg></div>' +
                '<div style="font-weight:600;color:var(--text-primary);margin-bottom:4px">还没有记录</div>' +
                '<div>做完一次诊断，报告会自动存到这里</div>' +
                '<div style="margin-top:20px"><button class="btn sm" id="rec-go">去诊断</button></div></div>';
            var g = $('rec-go');
            if (g) g.onclick = function () { go('home'); };
            return;
        }
        box.innerHTML = list.map(function (r) {
            var cls = r.rate >= 80 ? 'm' : (r.rate >= 50 ? 's' : 'w');
            return '<div class="rec-item" data-id="' + esc(r.id) + '">' +
                '<span class="rec-bar ' + cls + '"></span>' +
                '<div class="rec-main">' +
                '<div class="rec-t">' + esc([SUBJ[r.subject] ? SUBJ[r.subject].name : '', r.grade, r.chapter]
                    .filter(Boolean).join(' · ')) + '</div>' +
                '<div class="rec-s">' + esc(fmtDate(r.ts)) + ' · 做了 ' + (r.asked || 0) + ' 道题' +
                ' · 薄弱 ' + (r.weak || 0) + '</div>' +
                '</div>' +
                '<div class="rec-rate">' + r.rate + '%</div>' +
                '<button class="rec-del" data-del="' + esc(r.id) + '" aria-label="删除">' +
                '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg></button>' +
                '</div>';
        }).join('');
        box.querySelectorAll('.rec-item').forEach(function (el) {
            el.onclick = function (e) {
                var d = e.target.closest('[data-del]');
                if (d) { e.stopPropagation(); delRec(d.getAttribute('data-del')); return; }
                openRec(el.getAttribute('data-id'));
            };
        });
    }
    function fmtDate(ts) {
        var d = new Date(ts);
        var p = function (n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
            ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function delRec(id) {
        var a = loadRec().filter(function (r) { return r.id !== id; });
        saveRec(a); recBadge(); renderRecords(); renderStats();
        toast('已删除');
    }
    function openRec(id) {
        var r = loadRec().filter(function (x) { return x.id === id; })[0];
        if (!r) { toast('记录不存在'); return; }
        renderReport(r, null, false, true);
    }

    /* ---------------- 思维导图 ---------------- */
    function mindFill(what) {
        var ss = $('m-subj'), gs = $('m-grade'), cs = $('m-chap');
        if (what === 'subj' || !S.subjM) {
            ss.innerHTML = SUBJ_ORDER.map(function (k) {
                return '<option value="' + k + '">' + SUBJ[k].name + '</option>';
            }).join('');
            S.subjM = S.subjM || SUBJ_ORDER[0];
        }
        ss.value = S.subjM;

        var gm = {};
        S.topics.forEach(function (t) { if (subjOf(t.id) === S.subjM) gm[t.grade] = 1; });
        var gk = Object.keys(gm).map(Number).sort(function (a, b) { return a - b; });
        if (gk.indexOf(S.gradeM) < 0) S.gradeM = gk[0];
        gs.innerHTML = gk.map(function (g) {
            return '<option value="' + g + '">' + gradeName(g) + '</option>';
        }).join('');
        gs.value = S.gradeM;

        var map = {};
        S.topics.forEach(function (t) {
            if (subjOf(t.id) !== S.subjM || t.grade !== S.gradeM) return;
            var c = normChapter(t.chapter) || '其他';
            (map[c] = map[c] || []).push(t.id);
        });
        var ck = Object.keys(map);
        if (ck.indexOf(S.chapM) < 0) S.chapM = ck[0];
        cs.innerHTML = ck.map(function (c) {
            return '<option value="' + esc(c) + '">' + esc(c) + '（' + map[c].length + '）</option>';
        }).join('');
        cs.value = S.chapM;
        S.chapMapM = map;
        drawMind();
    }

    function drawMind() {
        var box = $('mind');
        if (!S.chapMapM || !S.chapM) { box.innerHTML = '<div class="empty">暂无数据</div>'; return; }
        var ids = S.chapMapM[S.chapM] || [];
        if (!ids.length) { box.innerHTML = '<div class="empty">该章节暂无知识点</div>'; return; }

        var set = {};
        ids.forEach(function (i) { set[i] = 1; });
        // 只画章内关系：跨章的先修不在这张图里，画了会连到不存在的节点
        var edges = (S.deps || []).filter(function (d) {
            return set[d.topicId] && set[d.prerequisiteId];
        });

        // 分层：先修在上，后继在下；环（数据偶有）靠迭代上限兜住
        var layer = {};
        ids.forEach(function (i) { layer[i] = 0; });
        for (var k = 0; k < ids.length; k++) {
            var changed = false;
            edges.forEach(function (e) {
                var w = layer[e.prerequisiteId] + 1;
                if (w > layer[e.topicId]) { layer[e.topicId] = w; changed = true; }
            });
            if (!changed) break;
        }

        var byL = {};
        ids.forEach(function (i) { (byL[layer[i]] = byL[layer[i]] || []).push(i); });
        var Ls = Object.keys(byL).map(Number).sort(function (a, b) { return a - b; });

        /* 层内折行：大章节单层摊开会横向拉到几千像素，
           纵向折行更好读。PER 是每行列数，ROWH 是折出来的行高。 */
        /* 手机上按 3 列折行：6 列会把图撑到 572px 宽，容器只有 358px，
           只能横向拖着看。竖着排虽然高一点，但至少是上下滚，不用歪着头拖。 */
        var narrow = window.innerWidth <= 768;
        var COL = narrow ? 104 : 128, ROW = 96, ROWH = narrow ? 52 : 58,
            PER = narrow ? 3 : 6, PAD = 30;
        var maxN = 0;
        Ls.forEach(function (L) {
            var r = Math.ceil(byL[L].length / PER);
            maxN = Math.max(maxN, Math.min(byL[L].length, PER));
        });
        var yoff = {}, acc = 0;
        Ls.forEach(function (L) {
            yoff[L] = acc;
            acc += (Math.ceil(byL[L].length / PER) - 1) * ROWH;
        });

        var W = Math.max(maxN * COL, 260) + PAD * 2;
        var H = Ls.length * ROW + acc + PAD * 2 + 24;
        var pos = {};
        Ls.forEach(function (L) {
            var arr = byL[L], n = arr.length;
            var rows = Math.ceil(n / PER);
            for (var ri = 0; ri < rows; ri++) {
                var seg = arr.slice(ri * PER, ri * PER + PER);
                var x0 = (W - seg.length * COL) / 2 + COL / 2;
                seg.forEach(function (id, i) {
                    pos[id] = { x: x0 + i * COL, y: PAD + L * ROW + yoff[L] + ri * ROWH + 24 };
                });
            }
        });

        // 状态：取最近一条覆盖过该知识点的记录
        var st = {};
        var recs = loadRec();
        for (var ri = recs.length - 1; ri >= 0; ri--) {
            var m = recs[ri].states || {};
            Object.keys(m).forEach(function (id) {
                if (st[id]) return;
                st[id] = m[id] === 'M' ? 'mastered' : (m[id] === 'W' ? 'weak' : (m[id] === 'S' ? 'shaky' : 'unknown'));
            });
        }
        var fill = { mastered: '#15803d', shaky: '#b45309', weak: '#b91c1c', unknown: '#c8cfd8' };
        var opa = { mastered: 1, shaky: 1, weak: 1, unknown: .5 };

        var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
            '" style="max-width:100%;height:auto">' +
            '<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ' +
            'orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor" opacity=".55"></path></marker></defs>';

        svg += '<g style="color:var(--border-color)">';
        edges.forEach(function (e) {
            var a = pos[e.topicId], b = pos[e.prerequisiteId];
            if (!a || !b) return;
            var my = (a.y + b.y) / 2;
            svg += '<path class="mlink" d="M' + a.x + ' ' + (a.y - 11) +
                ' C ' + a.x + ' ' + my + ' ' + b.x + ' ' + my + ' ' + b.x + ' ' + (b.y + 11) +
                '" marker-end="url(#ar)"></path>';
        });
        svg += '</g>';

        ids.forEach(function (id) {
            var p = pos[id], t = S.graph.byId[id];
            var s = st[id] || 'unknown';
            var nm = (t && t.name) || id;
            var short = nm.length > 7 ? nm.slice(0, 7) + '…' : nm;
            svg += '<g class="mnode" data-id="' + esc(id) + '">' +
                '<circle cx="' + p.x + '" cy="' + p.y + '" r="9" fill="' + fill[s] +
                '" opacity="' + opa[s] + '" stroke="var(--bg-primary)" stroke-width="2"></circle>' +
                '<text x="' + p.x + '" y="' + (p.y + 24) + '" text-anchor="middle">' + esc(short) + '</text>' +
                '<title>' + esc(nm) + '</title></g>';
        });
        svg += '</svg>';
        box.innerHTML = svg;

        box.querySelectorAll('.mnode').forEach(function (g) {
            g.onclick = function () {
                var id = g.getAttribute('data-id');
                var t = S.graph.byId[id];
                var pre = (S.deps || []).filter(function (d) { return d.topicId === id; })
                    .map(function (d) { return (S.graph.byId[d.prerequisiteId] || {}).name || d.prerequisiteId; });
                toast((t ? t.name : id) + (pre.length ? '　需要先会：' + pre.slice(0, 3).join('、') : '　没有先修'));
            };
        });
    }

    /* ---------------- 账号 ---------------- */
    function getName() {
        try { return localStorage.getItem(NK) || '学习者'; } catch (e) { return '学习者'; }
    }
    function setName(n) {
        try { localStorage.setItem(NK, n); } catch (e) {}
        paintUser();
    }
    function paintUser() {
        var n = getName();
        var c = (n || '学').trim().slice(0, 1) || '学';
        $('sb-avatar').textContent = c;
        $('ac-avatar').textContent = c;
        $('sb-name').textContent = n;
        var cnt = loadRec().length;
        $('sb-sub').textContent = cnt ? cnt + ' 份记录' : '本地账号';
    }
    function renderStats() {
        var r = loadRec();
        var asked = 0, rate = 0, weak = 0;
        r.forEach(function (x) { asked += x.asked || 0; rate += x.rate || 0; weak += x.weak || 0; });
        var avg = r.length ? Math.round(rate / r.length) : 0;
        var last = r.length ? fmtDate(r[0].ts).slice(0, 10) : '—';
        $('ac-stats').innerHTML =
            stat(r.length, '诊断次数') + stat(asked, '累计题数') +
            stat(avg + '%', '平均掌握度') + stat(weak, '累计薄弱点') +
            stat(last, '最近一次');
    }
    function stat(v, k) {
        return '<div class="stat"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + '</div></div>';
    }
    function applyTheme(t) {
        var dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.body.classList.toggle('dark-mode', dark);
        document.querySelectorAll('#th-seg button').forEach(function (b) {
            b.classList.toggle('on', b.getAttribute('data-th') === t);
        });
        $('th-ds').textContent = t === 'auto' ? '跟随系统' : (t === 'dark' ? '始终深色' : '始终浅色');
    }
    function getTheme() {
        try { return localStorage.getItem(TK) || 'auto'; } catch (e) { return 'auto'; }
    }

    /* ---------------- 启动 ---------------- */
    function init() {
        var code = window.ShareCode.fromLocation();
        var loads = [
            fetch('data/topics.json').then(function (r) { return r.json(); }),
            fetch('data/dependencies.json').then(function (r) { return r.json(); })
        ];
        Promise.all(loads).then(function (a) {
            S.topics = a[0];
            S.deps = a[1];
            S.graph = E.buildGraph(a[0], a[1]);
            recBadge();
            paintUser();
            // 报告链接优先：带着 #r/xxx 进来的人要看的是报告
            if (code) { return openShared(code); }
            renderHome();
            restoreLast();
            route();
        }).catch(function (e) {
            $('v-load').innerHTML = '<div class="empty">题库加载失败：' + esc(e.message) +
                '<br><br>请检查网络后刷新。</div>';
        });
    }

    /* 路由：#/home #/records #/mind #/account */
    function hashView() {
        var m = /^#\/(\w+)/.exec(location.hash || '');
        return m ? m[1] : 'home';
    }
    function route() {
        var v = hashView();
        if (v === 'records') { renderRecords(); view('v-records'); return; }
        if (v === 'mind') { if (!S.chapMapM) mindFill('subj'); view('v-mind'); return; }
        if (v === 'account') { renderAccount(); view('v-account'); return; }
        // 只有没处在答题/报告中途时才回首页，否则会打断流程
        var inQuiz = $('v-quiz').classList.contains('on');
        var inRep = $('v-report').classList.contains('on');
        if (!inQuiz && !inRep) { renderHome(); view('v-home'); }
    }
    function go(v) {
        location.hash = '#/' + v;
        route();
    }

    /* ---------------- 首页 ---------------- */
    function renderHome() {
        var box = $('subs');
        box.innerHTML = SUBJ_ORDER.map(function (k) {
            var n = S.topics.filter(function (t) { return subjOf(t.id) === k; }).length;
            return '<div class="sub" data-s="' + k + '">' +
                '<div class="n">' + SUBJ[k].name + '</div>' +
                '<div class="c">' + SUBJ[k].sub + '</div>' +
                '<div class="badge">' + n + ' 个知识点</div></div>';
        }).join('');
        box.querySelectorAll('.sub').forEach(function (el) {
            el.onclick = function () { pickSubj(el.getAttribute('data-s')); };
            /* 补回选中态：原先只有点击时才加 on，而从别的页切回来会整个重渲染，
               结果「开始诊断」明明可点，科目却一个都没高亮——看着像坏了。 */
            if (S.subj && el.getAttribute('data-s') === S.subj) el.classList.add('on');
        });
        if (!S.subj) {
            $('grades').innerHTML = '';
            $('sect-chap').style.display = 'none';
            updateCta();
        }
    }

    function pickSubj(k) {
        S.subj = k; S.grade = null; S.chap = null;
        $('subs').querySelectorAll('.sub').forEach(function (e) {
            e.classList.toggle('on', e.getAttribute('data-s') === k);
        });
        var gs = {};
        S.topics.forEach(function (t) { if (subjOf(t.id) === k) gs[t.grade] = (gs[t.grade] || 0) + 1; });
        var keys = Object.keys(gs).map(Number).sort(function (a, b) { return a - b; });
        $('grades').innerHTML = keys.map(function (g) {
            return '<button class="g" data-g="' + g + '">' + gradeName(g) + '</button>';
        }).join('');
        $('grades').querySelectorAll('.g').forEach(function (el) {
            el.onclick = function () { pickGrade(Number(el.getAttribute('data-g'))); };
        });
        $('sect-chap').style.display = 'none';
        updateCta();
    }

    function pickGrade(g) {
        S.grade = g; S.chap = null;
        $('grades').querySelectorAll('.g').forEach(function (e) {
            e.classList.toggle('on', Number(e.getAttribute('data-g')) === g);
        });
        var map = {};
        S.topics.forEach(function (t) {
            if (subjOf(t.id) !== S.subj || t.grade !== g) return;
            var c = normChapter(t.chapter) || '其他';
            (map[c] = map[c] || []).push(t.id);
        });
        var chaps = Object.keys(map);
        S.chapMap = map;
        $('chaps').innerHTML = chaps.map(function (c, i) {
            return '<button class="ch" data-c="' + esc(c) + '">' +
                '<span class="idx">' + (i + 1) + '</span>' +
                '<span class="nm">' + esc(c) + '</span>' +
                '<span class="ct">' + map[c].length + '</span></button>';
        }).join('');
        $('chaps').querySelectorAll('.ch').forEach(function (el) {
            el.onclick = function () { pickChap(el.getAttribute('data-c')); };
        });
        $('sect-chap').style.display = chaps.length ? 'block' : 'none';
        if (!chaps.length) $('chaps').innerHTML = '<div class="empty">该年级暂无数据</div>';
        if (S.chap && map[S.chap]) {
            $('chaps').querySelectorAll('.ch').forEach(function (e) {
                e.classList.toggle('on', e.getAttribute('data-c') === S.chap);
            });
        }
        updateCta();
    }

    function pickChap(c) {
        S.chap = c; S.chapIds = (S.chapMap || {})[c] || [];
        $('chaps').querySelectorAll('.ch').forEach(function (e) {
            e.classList.toggle('on', e.getAttribute('data-c') === c);
        });
        updateCta();
        saveLast();
        /* 选完最后一步，「开始诊断」还留在 1435px 处，手机上得再滚一屏多才看得见。
           选完就把它送到眼前——顺手把章节列表收起，省得挡着。 */
        var cta = document.querySelector('.cta');
        if (cta && cta.scrollIntoView) {
            try { cta.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
        }
    }

    /* ---------------- 记住上次的选择 ----------------
       每次进来都要重新点三下是最磨人的。存下来，下次直接就位。 */
    var SK = 'mathcn_last_v1';
    function saveLast() {
        if (!(S.subj && S.grade && S.chap)) return;
        try { localStorage.setItem(SK, JSON.stringify({ s: S.subj, g: S.grade, c: S.chap })); } catch (e) {}
    }
    function loadLast() {
        try { return JSON.parse(localStorage.getItem(SK)); } catch (e) { return null; }
    }
    function restoreLast() {
        var l = loadLast();
        if (!l || !l.s) return false;
        pickSubj(l.s);
        if (l.g && $('grades').querySelector('[data-g="' + l.g + '"]')) pickGrade(l.g);
        if (l.c && (S.chapMap || {})[l.c]) pickChap(l.c);
        return !!(S.subj && S.grade && S.chap);
    }

    function updateCta() {
        var ok = !!(S.subj && S.grade && S.chap);
        $('btn-start').disabled = !ok;
        $('hint').textContent = ok
            ? '共 ' + S.chapIds.length + ' 个知识点，最多 ' + LIMIT + ' 道题'
            : (S.subj ? (S.grade ? '选一个章节' : '选年级') : '先选科目和年级');
    }

    function start() {
        saveLast();
        S.session = E.createSession(S.graph, S.chapIds.slice(), { limit: LIMIT });
        S.answered = 0;
        $('bar').style.width = '0%';
        view('v-quiz');
        nextQ();
    }

    /* ---------------- 选项生成 ----------------
       题库 2313 题全是填空（question + answer，没有一道自带 options）。
       手机上每题都要敲键盘是最劝退的一步，所以这里给合适的题补上选项。
       只挑「干扰项说得通」的题：数字答案配邻近值，短文本配同章答案。
       挑不出来就老老实实填空，绝不硬凑一个一眼假的错误项。 */
    function alike(a, b) {
        var ha = /[\u4e00-\u9fa5]/.test(a), hb = /[\u4e00-\u9fa5]/.test(b);
        if (ha !== hb) return false;                       // 中英不混
        // 一方带数字/字母、另一方是纯汉字，摆在一起很扎眼
        // （「分子势能最小」旁边放「4/3 倍」，谁都能看出哪个是凑的）
        if (/[0-9A-Za-z]/.test(a) !== /[0-9A-Za-z]/.test(b)) return false;
        var la = a.length, lb = b.length;
        if (la && lb) {
            var r = la > lb ? la / lb : lb / la;
            if (r > 2.4) return false;                     // 长短差太多也不像
        }
        return true;
    }

    function genOpts(q, topicId) {
        var a = String(q.answer == null ? '' : q.answer).trim();
        if (!a) return null;
        var pool = [];
        if (/^-?\d+(\.\d+)?$/.test(a)) {
            // 数学题的错解基本都差一点点，邻近值就是最好的干扰项
            var n = parseFloat(a);
            [n + 1, n - 1, n + 2, n - 2, n + 10, n - 10, n * 2, n + 5]
                .concat(n === 0 ? [] : [Math.round(n / 2)])
                .forEach(function (x) {
                    if (!isFinite(x)) return;
                    var s = String(Math.round(x * 100) / 100);
                    // 小数答案只配小数干扰项，混进整数反而暴露答案
                    if (a.indexOf('.') >= 0 && s.indexOf('.') < 0) return;
                    if (s !== a && pool.indexOf(s) < 0) pool.push(s);
                });
        } else if (a.length <= 40) {
            /* 同章其它题的答案。题库里有 648 道题干写着「下列哪一句/哪一个正确」，
               却只存了正确选项没有干扰项——同章采来的正好就是同类的说法，
               质量和人工出的选择项接近。采不到就退回填空，不硬凑。 */
            var t = S.graph.byId[topicId];
            var ch = t ? t.chapter : '', g = t ? t.grade : null, sj = t ? subjOf(t.id) : null;
            /* 三级兜底：同章 → 同年级同学科 → 同学科。
               章节切得很细（有的章只有两三个知识点），只盯同章会采不满，
               结果明明是「下列哪一句正确」，却只能让用户打字。 */
            var tiers = [
                function (x) { return ch && x.chapter === ch; },
                function (x) { return x.grade === g && subjOf(x.id) === sj; },
                function (x) { return subjOf(x.id) === sj; }
            ];
            var cand = [];
            tiers.forEach(function (fit) {
                if (cand.length >= 3) return;
                var got = [];
                S.topics.forEach(function (x) {
                    if (got.length >= 3 || !fit(x)) return;
                    var b = String((x.diagnostic_question || {}).answer || '').trim();
                    if (!b || b === a || b.length > 40) return;
                    if (!alike(a, b)) return;
                    if (got.indexOf(b) >= 0 || cand.indexOf(b) >= 0) return;
                    got.push(b);
                });
                // 先挑长度最接近的，读起来最像同一道题的选项
                got.sort(function (x, y) {
                    return Math.abs(x.length - a.length) - Math.abs(y.length - a.length);
                });
                cand = cand.concat(got.slice(0, 3 - cand.length));
            });
            pool = cand.slice(0, 3);
        }
        if (pool.length < 2) return null;
        var opts = [a].concat(pool.slice(0, 3));
        // 洗牌：正确答案不能总待在同一个位置
        for (var i = opts.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = opts[i]; opts[i] = opts[j]; opts[j] = tmp;
        }
        return opts;
    }

    function advance() {
        clearTimeout(S.autoT);
        if (S.answered >= LIMIT || !E.nextItem(S.graph, S.session)) finish();
        else nextQ();
    }

    /* ---------------- 答题 ---------------- */
    function nextQ() {
        clearTimeout(S.autoT);
        S.item = E.nextItem(S.graph, S.session);
        if (!S.item) { finish(); return; }

        var t = S.graph.byId[S.item.topicId];
        $('q-prog').textContent = '第 ' + (S.answered + 1) + ' 题 / 最多 ' + LIMIT;
        $('q-topic').textContent = t ? t.name : '';
        /* 答错后引擎会给同一知识点第二次机会，但题库每个点只存了一道题，
           于是题面字面完全一样——不明说的话，用户会以为页面卡住了。 */
        var again = S.item.topicId === S.lastTopic;
        var tag = $('q-again');
        if (again) { if (!tag) { $('q-topic').insertAdjacentHTML('afterend', '<span class="chip again" id="q-again">再确认一次</span>'); } }
        else if (tag) { tag.remove(); }
        S.lastTopic = S.item.topicId;
        $('q-from').textContent = t ? (t.chapter || '') : '';
        $('q-text').textContent = S.item.question.prompt;

        var q = S.item.question;
        var box = $('q-input'), acts = $('q-acts');
        $('q-fb').innerHTML = '';
        S.manual = false;

        var opts = (q.options && q.options.length) ? q.options : genOpts(q, S.item.topicId);
        if (opts && opts.length) {
            box.innerHTML = '<div class="opts">' + opts.map(function (o) {
                return '<button class="opt" data-o="' + esc(o) + '">' + esc(o) + '</button>';
            }).join('') + '</div>';
            box.querySelectorAll('.opt').forEach(function (b) {
                b.onclick = function () { answer(b.getAttribute('data-o')); };
            });
            acts.innerHTML = '<button class="btn minor" id="q-skip">不会，跳过</button>';
        } else {
            // 数字答案直接给数字键盘，别让人在手机上切输入法
            var ans = String(q.answer == null ? '' : q.answer).trim();
            var numeric = /^-?\d+(\.\d+)?$/.test(ans);
            box.innerHTML = '<input class="ans" id="q-ans" ' +
                (numeric ? 'inputmode="' + (ans.indexOf('.') >= 0 ? 'decimal' : 'numeric') + '" ' : '') +
                'placeholder="' + (numeric ? '填数字，回车提交' : '填写答案，回车提交') +
                '" autocomplete="off">';
            acts.innerHTML = '<button class="btn" id="q-ok">提交</button>' +
                '<button class="btn minor" id="q-skip">不会</button>';
            var inp = $('q-ans');
            inp.focus();
            inp.onkeydown = function (e) { if (e.key === 'Enter') answer(inp.value); };
            $('q-ok').onclick = function () { answer(inp.value); };
        }
        $('q-skip').onclick = function () { answer(''); };
        bar();
    }

    function answer(text) {
        if (S.manual) return;
        var q = S.item.question;
        var jd = E.judgeQuestion(q, text);
        if (jd.verdict === 'manual' && String(text || '').trim() !== '') return askSelf(text);
        var ok = jd.verdict === 'correct';
        apply(ok ? 'correct' : 'wrong', text, ok, jd);
    }

    function askSelf(text) {
        S.manual = true;
        $('q-fb').innerHTML =
            '<div class="fb"><b>这题需要你自己判断</b>' +
            '<span class="why">你填的是：' + esc(String(text || '').trim() || '（空）') + '</span>' +
            '<span class="why">参考答案：' + esc(S.item.question.answer) + '</span>' +
            '<div class="acts" style="margin-top:12px">' +
            '<button class="btn sm" id="mf-ok">我答对了</button>' +
            '<button class="btn sm minor" id="mf-no">我答错了</button></div></div>';
        $('mf-ok').onclick = function () { apply('correct', text, true, { reason: 'self' }); };
        $('mf-no').onclick = function () { apply('wrong', text, false, { reason: 'self' }); };
    }

    function apply(verdict, text, ok, jd) {
        S.session = E.applyAnswer(S.graph, S.session, S.item.topicId, verdict, { text: text });
        S.answered++;

        var q = S.item.question;
        var why = q.explanation || (q.answer ? '参考答案：' + q.answer : '');
        $('q-fb').innerHTML = '<div class="fb ' + (ok ? 'ok' : 'no') + '">' +
            (ok ? '答对了' : (verdict === 'skip' || text === '' ? '已跳过' : '答错了')) +
            (why ? '<span class="why">' + esc(why) + '</span>' : '') + '</div>';
        var last = S.answered >= LIMIT || !E.nextItem(S.graph, S.session);
        $('q-acts').innerHTML = '<button class="btn" id="q-next">' +
            (last ? '看报告' : '下一题') + '</button>';
        $('q-next').onclick = advance;
        bar();
        /* 答完自动往下走，省掉一次点击。
           答对停 1.2 秒（够看清对错），答错停 2.6 秒（够读完解析），
           自己判分的停 2.2 秒。想快进就戳「下一题」，定时器会被 advance 清掉。 */
        var wait = ok ? 1200 : 2600;
        if (jd && jd.reason === 'self') wait = 2200;
        S.autoT = setTimeout(advance, wait);
    }

    function bar() {
        $('bar').style.width = Math.min(100, (S.answered / LIMIT) * 100) + '%';
    }

    /* ---------------- 报告 ---------------- */
    function finish() {
        var sum = E.summarize(S.graph, S.session);
        S.sum = sum;
        var rep = {
            subject: S.subj, grade: gradeName(S.grade), chapter: S.chap,
            mode: sum.mode, ts: Date.now(), asked: sum.asked,
            states: stateMap(sum), masteredCount: sum.mastered.length,
            targets: S.chapIds.slice()
        };
        // 先存记录，再渲染 —— 记录里的 rate 由渲染层统一算，避免两处口径不一
        var path0 = sum.path || [];
        var total0 = path0.length + rep.masteredCount;
        var weak0 = path0.filter(function (p) { return p.status === 'weak'; }).length;
        var shaky0 = path0.filter(function (p) { return p.status === 'shaky'; }).length;
        var recs = loadRec();
        recs.unshift({
            id: 'r' + rep.ts, ts: rep.ts, subject: rep.subject, grade: rep.grade,
            chapter: rep.chapter, asked: rep.asked,
            rate: pct(rep.masteredCount, total0),
            weak: weak0, shaky: shaky0, mastered: rep.masteredCount,
            states: rep.states
        });
        saveRec(recs.slice(0, 200));
        recBadge(); paintUser();
        renderReport(rep, sum, false);
    }

    function stateMap(sum) {
        var m = {};
        sum.mastered.forEach(function (i) { m[i] = 'M'; });
        sum.shaky.forEach(function (i) { m[i] = 'S'; });
        sum.weak.forEach(function (i) { m[i] = 'W'; });
        sum.untested.forEach(function (i) { m[i] = 'U'; });
        return m;
    }

    function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }

    function renderReport(rep, sum, shared, fromRecord) {
        var path = sum ? sum.path : buildPathFromStates(rep);
        var total = path.length + rep.masteredCount;
        var mastered = rep.masteredCount;
        var weak = path.filter(function (p) { return p.status === 'weak'; }).length;
        var shaky = path.filter(function (p) { return p.status === 'shaky'; }).length;
        var rest = path.length - weak - shaky;
        var rate = pct(mastered, total);

        var R = 54, C = 2 * Math.PI * R;
        var seg = [['var(--ok)', mastered], ['var(--bad)', weak], ['var(--warn)', shaky], ['var(--untested)', rest]];
        var off = 0, arcs = '';
        seg.forEach(function (s) {
            if (!s[1] || !total) return;
            var len = C * s[1] / total;
            arcs += '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + s[0] +
                '" stroke-width="15" stroke-linecap="butt" stroke-dasharray="' + (len - 1.5) + ' ' + (C - len + 1.5) +
                '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 70 70)"/>';
            off += len;
        });

        var html = '';
        html += '<div class="rhead"><h2>学习报告</h2><div class="sub2">' +
            esc([SUBJ[rep.subject] ? SUBJ[rep.subject].name : '', rep.grade, rep.chapter]
                .filter(Boolean).join(' · ')) +
            (rep.ts ? ' · ' + fmtDate(rep.ts).slice(0, 10) : '') +
            (rep.asked ? ' · 做了 ' + rep.asked + ' 道题' : '') + '</div></div>';

        html += '<div class="ring"><svg width="140" height="140" viewBox="0 0 140 140">' +
            '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="var(--bg-tertiary)" stroke-width="15"/>' +
            arcs +
            '<text x="70" y="66" text-anchor="middle" class="rnum" fill="var(--text-primary)">' + rate + '%</text>' +
            '<text x="70" y="86" text-anchor="middle" class="rlbl" fill="var(--text-tertiary)">掌握度</text>' +
            '</svg><div class="legend">' +
            [['var(--ok)', '已掌握', mastered], ['var(--bad)', '薄弱', weak],
             ['var(--warn)', '不稳', shaky], ['var(--untested)', '未测', rest]]
                .map(function (l) {
                    return '<div class="lg"><i style="background:' + l[0] + '"></i>' + l[1] +
                        '<span class="v">' + l[2] + '</span></div>';
                }).join('') +
            '</div></div>';

        var roots = sum ? sum.roots : [];
        if (roots.length) {
            html += '<div class="card"><h3>最该先补的</h3>' +
                '<p class="cap">它们是这一章里最靠前的薄弱点，后面的内容都压在上面</p><div class="steps">';
            roots.slice(0, 6).forEach(function (r, i) {
                var t = S.graph.byId[r.id];
                html += '<div class="step"><span class="no w">' + (i + 1) + '</span>' +
                    '<div class="bd"><div class="nm">' + esc(t ? t.name : r.id) + '</div>' +
                    '<div class="ds">' + esc(t ? (t.chapter || '') : '') + '</div></div>' +
                    '<span class="gd">' + (t ? gradeName(t.grade) : '') + '</span></div>';
            });
            html += '</div></div>';
        }

        if (path.length) {
            html += '<div class="card"><h3>建议的练习顺序</h3>' +
                '<p class="cap">按年级从低到高、先修在前排列，共 ' + path.length + ' 个知识点</p><div class="steps">';
            path.slice(0, 20).forEach(function (p, i) {
                var t = S.graph.byId[p.id];
                var cls = ST_CLS[p.status] || 'u';
                html += '<div class="step"><span class="no ' + cls + '">' + (i + 1) + '</span>' +
                    '<div class="bd"><div class="nm">' + esc(t ? t.name : p.id) +
                    (p.isRoot ? '<span class="tag w">根因</span>' : '') +
                    (p.isTarget ? '<span class="tag m">本章</span>' : '') + '</div>' +
                    '<div class="ds">' + esc(t ? (t.description || t.chapter || '') : '') + '</div></div>' +
                    '<span class="gd">' + (t ? gradeName(t.grade) : '') + '</span></div>';
            });
            if (path.length > 20) html += '<div class="ds" style="padding-top:12px">…还有 ' + (path.length - 20) + ' 个</div>';
            html += '</div></div>';
        } else {
            html += '<div class="card"><h3>全部掌握</h3><p class="cap">这一章没有发现薄弱点</p></div>';
        }

        html += '<div class="sharebox">';
        if (fromRecord) {
            html += '<p class="cap" style="margin:0">这是 ' + fmtDate(rep.ts) + ' 的一次记录</p>' +
                '<div style="margin-top:14px"><button class="btn sm ghost" id="r-back">返回记录列表</button> ' +
                '<button class="btn sm ghost" id="r-print">打印 / 存为 PDF</button></div>';
        } else if (!shared) {
            html += '<h3 style="margin:0 0 4px">分享这份报告</h3>' +
                '<p class="cap">链接里就带着结果，对方打开直接看到这份报告</p>' +
                '<button class="btn sm" id="r-share">生成链接</button>' +
                '<div id="r-link"></div>' +
                '<div style="margin-top:14px"><button class="btn sm ghost" id="r-again">再测一次</button> ' +
                '<button class="linkbtn" id="r-print">打印 / 存为 PDF</button></div>';
        } else {
            html += '<p class="cap" style="margin:0">这是一份分享来的报告</p>' +
                '<div style="margin-top:14px"><button class="btn sm ghost" id="r-mine">我也测一下</button> ' +
                '<button class="btn sm ghost" id="r-print">打印 / 存为 PDF</button></div>';
        }
        html += '</div>';

        $('report').innerHTML = html;
        view('v-report');

        var bs = $('r-share');
        if (bs) bs.onclick = function () {
            bs.disabled = true; bs.textContent = '生成中…';
            window.ShareCode.encode(rep).then(function (code) {
                var u = window.ShareCode.url(code, true);
                $('r-link').innerHTML = '<input readonly value="' + esc(u) + '" id="r-url">' +
                    '<div style="margin-top:10px"><button class="btn sm ghost" id="r-copy">复制</button> ' +
                    '<a class="btn sm ghost" href="' + esc(u) + '" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block">打开</a></div>';
                $('r-copy').onclick = function () {
                    var el = $('r-url'); el.select();
                    navigator.clipboard && navigator.clipboard.writeText(u)
                        .then(function () { toast('已复制'); })
                        .catch(function () { document.execCommand('copy'); toast('已复制'); });
                };
                bs.textContent = '重新生成';
                bs.disabled = false;
            }).catch(function (e) { toast('生成失败：' + e.message); bs.disabled = false; bs.textContent = '生成链接'; });
        };
        var ba = $('r-again');
        if (ba) ba.onclick = function () {
            if (!S.chapIds || !S.chapIds.length) { go('home'); return; }
            start();
        };
        var bm = $('r-mine');
        if (bm) bm.onclick = function () { location.hash = ''; renderHome(); view('v-home'); };
        var bk = $('r-back');
        if (bk) bk.onclick = function () { go('records'); };
        var pr = $('r-print');
        if (pr) pr.onclick = function () { window.print(); };
    }

    function buildPathFromStates(rep) {
        var ids = Object.keys(rep.states).filter(function (i) { return rep.states[i] !== 'M'; });
        var pos = {};
        S.topics.forEach(function (t, i) { pos[t.id] = i; });
        return ids.sort(function (a, b) {
            var ta = S.graph.byId[a], tb = S.graph.byId[b];
            return ((ta ? ta.grade : 99) - (tb ? tb.grade : 99)) || (pos[a] - pos[b]);
        }).map(function (i) {
            var c = rep.states[i];
            return { id: i, status: c === 'W' ? 'weak' : (c === 'S' ? 'shaky' : 'unknown'), isRoot: false, isTarget: false };
        });
    }

    function openShared(code) {
        return window.ShareCode.decode(code).then(function (rep) {
            S.shared = rep;
            renderReport(rep, null, true);
        }).catch(function (e) {
            $('report').innerHTML = '<div class="empty" style="padding:80px 20px">' +
                '<div style="margin-bottom:14px;color:var(--text-tertiary)">' +
                '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M10 13a5 5 0 0 0 7.5.5l3-3A5 5 0 0 0 13.5 3.5L11.8 5.2"></path>' +
                '<path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path></svg></div>' +
                '<div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px">这份报告打不开</div>' +
                '<div>' + esc(e.message) + '</div>' +
                '<div style="margin-top:24px"><button class="btn sm ghost" id="r-mine">自己去测一个</button></div></div>';
            view('v-report');
            $('r-mine').onclick = function () { location.hash = ''; renderHome(); view('v-home'); };
        });
    }

    /* ---------------- 账号页 ---------------- */
    function renderAccount() {
        $('ac-name').value = getName();
        renderStats();
        applyTheme(getTheme());
    }

    /* ---------------- 事件 ---------------- */
    document.addEventListener('DOMContentLoaded', function () {
        applyTheme(getTheme());
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
            if (getTheme() === 'auto') applyTheme('auto');
        });

        // 侧边栏
        $('sb-toggle').onclick = function () { sbOpen(true); };
        $('overlay').onclick = function () { sbOpen(false); };
        $('sb-close').onclick = function () { sbOpen(false); };
        document.querySelectorAll('.nav-item').forEach(function (a) {
            a.onclick = function (e) {
                e.preventDefault();
                var v = a.getAttribute('data-view');
                if (isMobile()) sbOpen(false);
                go(v);
            };
        });
        $('sb-user').onclick = function () { if (isMobile()) sbOpen(false); go('account'); };

        window.addEventListener('hashchange', function () { route(); });

        // 转屏 / 改窗口后导图要重排，否则手机上会留着桌面算出来的 6 列宽图
        var rzT;
        window.addEventListener('resize', function () {
            clearTimeout(rzT);
            rzT = setTimeout(function () {
                if ($('v-mind').classList.contains('on')) drawMind();
            }, 200);
        });

        // 诊断
        $('btn-start').onclick = start;
        $('btn-about').onclick = function () {
            toast('选章节 → 答题 → 顺着先修关系找薄弱根因');
        };

        // 思维导图
        $('m-subj').onchange = function () { S.subjM = this.value; S.gradeM = null; mindFill('subj'); };
        $('m-grade').onchange = function () { S.gradeM = Number(this.value); mindFill('grade'); };
        $('m-chap').onchange = function () { S.chapM = this.value; drawMind(); };

        // 账号
        $('ac-name').oninput = function () { setName(this.value.trim() || '学习者'); };
        document.querySelectorAll('#th-seg button').forEach(function (b) {
            b.onclick = function () {
                var t = b.getAttribute('data-th');
                try { localStorage.setItem(TK, t); } catch (e) {}
                applyTheme(t);
            };
        });
        $('ac-export').onclick = function () {
            var data = JSON.stringify(loadRec(), null, 2);
            var url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
            var a = document.createElement('a');
            a.href = url; a.download = '学情记录.json'; a.click();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            toast('已导出');
        };
        $('ac-clear').onclick = function () {
            if (!window.confirm('清空全部 ' + loadRec().length + ' 条学情记录？此操作无法恢复。')) return;
            saveRec([]); recBadge(); paintUser(); renderStats();
            toast('已清空');
        };

        init();
    });
})();
