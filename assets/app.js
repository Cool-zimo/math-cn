/* ============================================================
   学情诊断 · 主逻辑
   ------------------------------------------------------------
   一屏一件事：选范围 → 答题 → 报告。
   诊断算法全部来自上游 engine.js（纯函数、有 89 项测试背书），
   这里只负责界面与流程。
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
        graph: null, topics: null,
        subj: null, grade: null, chap: null,
        session: null, item: null,
        answered: 0, shared: null
    };

    var $ = function (id) { return document.getElementById(id); };
    function view(id) {
        ['v-load', 'v-home', 'v-quiz', 'v-report'].forEach(function (v) {
            $(v).classList.toggle('on', v === id);
        });
        window.scrollTo(0, 0);
    }
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
    /* ★ 章节粒度：原始 chapter 细到「1.1」小节，一个章平均只有 1.9 个知识点，
     *   选进去答一题就结束了，报告也没内容可看。
     *   去掉末尾的纯数字小节号后，平均 7 点/章 —— 一次诊断才有意义。
     *   只砍末尾是数字编号的段（"有理数 1.1"），像
     *   "5以内数的认识和加、减法" 这种本来就不是编号的，原样保留。 */
    function normChapter(c) {
        var a = String(c || '').split(/\s+/);
        if (a.length > 1 && /^[\d.]+$/.test(a[a.length - 1])) a.pop();
        return a.join(' ');
    }

    function gradeName(g) {
        var n = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
        if (g >= 1 && g <= 6) return n[g] + '年级';
        if (g >= 7 && g <= 9) return n[g] + '年级';
        if (g === 10) return '高一';
        if (g === 11) return '高二';
        if (g === 12) return '高三';
        if (g >= 13) return '选修 ' + (g - 12);
        return 'G' + g;
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
            S.graph = E.buildGraph(a[0], a[1]);
            // ★ 报告链接优先：带着 #r/xxx 进来的人要看的是报告，
            //   不是让他重新选一遍科目。
            if (code) { return openShared(code); }
            renderHome();
        }).catch(function (e) {
            $('v-load').innerHTML = '<div class="empty">题库加载失败：' + esc(e.message) +
                '<br><br>请检查网络后刷新。</div>';
        });
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
        });
        view('v-home');
    }

    function pickSubj(k) {
        S.subj = k; S.grade = null; S.chap = null;
        $('subs').querySelectorAll('.sub').forEach(function (e) {
            e.classList.toggle('on', e.getAttribute('data-s') === k);
        });
        // 只列出该科目真实存在的年级 —— 语文只有小学，物理从初二起，
        // 列全 1~16 会给出一堆点进去什么都没有的年级。
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
        $('chaps').innerHTML = chaps.map(function (c, i) {
            return '<button class="ch" data-c="' + esc(c) + '">' +
                '<span class="idx">' + (i + 1) + '</span>' +
                '<span class="nm">' + esc(c) + '</span>' +
                '<span class="ct">' + map[c].length + '</span></button>';
        }).join('');
        $('chaps').querySelectorAll('.ch').forEach(function (el) {
            el.onclick = function () { pickChap(el.getAttribute('data-c'), map); };
        });
        $('sect-chap').style.display = chaps.length ? 'block' : 'none';
        if (!chaps.length) $('chaps').innerHTML = '<div class="empty">该年级暂无数据</div>';
        updateCta();
    }

    function pickChap(c, map) {
        S.chap = c; S.chapIds = map[c];
        $('chaps').querySelectorAll('.ch').forEach(function (e) {
            e.style.borderColor = e.getAttribute('data-c') === c ? 'var(--brand)' : '';
            e.style.background = e.getAttribute('data-c') === c ? 'var(--brand-soft)' : '';
        });
        updateCta();
    }

    function updateCta() {
        var ok = !!(S.subj && S.grade && S.chap);
        $('btn-start').disabled = !ok;
        $('hint').textContent = ok
            ? '共 ' + S.chapIds.length + ' 个知识点，最多 ' + LIMIT + ' 道题'
            : (S.subj ? (S.grade ? '选一个章节' : '选年级') : '先选科目和年级');
    }

    function start() {
        S.session = E.createSession(S.graph, S.chapIds.slice(), { limit: LIMIT });
        S.answered = 0;
        view('v-quiz');
        nextQ();
    }

    /* ---------------- 答题 ---------------- */
    function nextQ() {
        S.item = E.nextItem(S.graph, S.session);
        if (!S.item) { finish(); return; }

        var t = S.graph.byId[S.item.topicId];
        $('q-prog').textContent = '第 ' + (S.answered + 1) + ' 题 / 最多 ' + LIMIT;
        $('q-topic').textContent = t ? t.name : '';
        $('q-from').textContent = t ? (t.chapter || '') : '';
        $('q-text').textContent = S.item.question.prompt;

        // 选择题：选项直接点。填空题：输入框。
        var q = S.item.question;
        var box = $('q-input'), acts = $('q-acts');
        $('q-fb').innerHTML = '';
        S.manual = false;

        if (q.options && q.options.length) {
            box.innerHTML = '<div class="opts">' + q.options.map(function (o, i) {
                return '<button class="opt" data-o="' + esc(o) + '">' + esc(o) + '</button>';
            }).join('') + '</div>';
            box.querySelectorAll('.opt').forEach(function (b) {
                b.onclick = function () { answer(b.getAttribute('data-o')); };
            });
            acts.innerHTML = '<button class="btn minor" id="q-skip">不会，跳过</button>';
        } else {
            box.innerHTML = '<input class="ans" id="q-ans" placeholder="填写答案，回车提交" autocomplete="off">';
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
        if (S.manual) return;      // 已进入自评状态
        var q = S.item.question;
        var jd = E.judgeQuestion(q, text);

        // manual = 引擎判不了（开放题/表述题）。★ 不能替用户瞎判，
        //   也不能卡住流程 —— 交给用户自己点"我对了/我错了"。
        if (jd.verdict === 'manual' && String(text || '').trim() !== '') {
            return askSelf(text);
        }

        var ok = jd.verdict === 'correct';
        apply(ok ? 'correct' : 'wrong', text, ok, jd);
    }

    function askSelf(text) {
        S.manual = true;
        $('q-fb').innerHTML =
            '<div class="fb"><b>这题需要你自己判断</b>' +
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
            (ok ? '✓ 答对了' : (verdict === 'skip' || text === '' ? '已跳过' : '✗ 答错了')) +
            (why ? '<span class="why">' + esc(why) + '</span>' : '') + '</div>';
        $('q-acts').innerHTML = '<button class="btn" id="q-next">' +
            (S.answered >= LIMIT ? '看报告' : '下一题') + '</button>';
        $('q-next').onclick = function () {
            if (S.answered >= LIMIT || !E.nextItem(S.graph, S.session)) finish();
            else nextQ();
        };
        bar();
    }

    function bar() {
        $('bar').style.width = Math.min(100, (S.answered / LIMIT) * 100) + '%';
    }

    /* ---------------- 报告 ---------------- */
    function finish() {
        var sum = E.summarize(S.graph, S.session);
        S.sum = sum;
        renderReport({
            subject: S.subj, grade: gradeName(S.grade), chapter: S.chap,
            mode: sum.mode, ts: Date.now(), asked: sum.asked,
            states: stateMap(sum), masteredCount: sum.mastered.length,
            targets: S.chapIds.slice()
        }, sum, false);
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

    function renderReport(rep, sum, shared) {
        // shared=true 时报告来自链接，此时只有 id 与状态，没有真实 session，
        // 路径要由 states 现算（见 buildPathFromStates）。
        var path = sum ? sum.path : buildPathFromStates(rep);
        var total = path.length + rep.masteredCount;
        var mastered = rep.masteredCount;
        var weak = path.filter(function (p) { return p.status === 'weak'; }).length;
        var shaky = path.filter(function (p) { return p.status === 'shaky'; }).length;
        var rest = path.length - weak - shaky;
        var rate = pct(mastered, total);

        // 环形图
        var R = 54, C = 2 * Math.PI * R;
        var seg = [['#15803d', mastered], ['#b91c1c', weak], ['#b45309', shaky], ['#dfe3e8', rest]];
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
        // ★ 题数必须写出来。自适应诊断答对就跳过所有先修，
        //   可能只问 1 题就得出"掌握度 100%"。不写题数的话，
        //   这个 100% 看着像测了整套卷子，其实是测了一道题。
        html += '<div class="rhead"><h2>学习报告</h2><div class="sub2">' +
            esc([SUBJ[rep.subject] ? SUBJ[rep.subject].name : '', rep.grade, rep.chapter]
                .filter(Boolean).join(' · ')) +
            (rep.ts ? ' · ' + new Date(rep.ts).toLocaleDateString('zh-CN') : '') +
            (rep.asked ? ' · 做了 ' + rep.asked + ' 道题' : '') + '</div></div>';

        html += '<div class="ring"><svg width="140" height="140" viewBox="0 0 140 140">' +
            '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="#f0f2f5" stroke-width="15"/>' +
            arcs +
            '<text x="70" y="66" text-anchor="middle" class="rnum" fill="#12181f">' + rate + '%</text>' +
            '<text x="70" y="86" text-anchor="middle" class="rlbl" fill="#8a97a8">掌握度</text>' +
            '</svg><div class="legend">' +
            [['#15803d', '已掌握', mastered], ['#b91c1c', '薄弱', weak],
             ['#b45309', '不稳', shaky], ['#c8cfd8', '未测', rest]]
                .map(function (l) {
                    return '<div class="lg"><i style="background:' + l[0] + '"></i>' + l[1] +
                        '<span class="v">' + l[2] + '</span></div>';
                }).join('') +
            '</div></div>';

        // 根因
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

        // 学习路径
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
            if (path.length > 20) html += '<div class="ds" style="padding-top:12px;color:#8a97a8">…还有 ' + (path.length - 20) + ' 个</div>';
            html += '</div></div>';
        } else {
            html += '<div class="card"><h3>全部掌握</h3><p class="cap">这一章没有发现薄弱点</p></div>';
        }

        // 分享（自己的报告才生成链接；看别人的报告不需要再生成一次）
        html += '<div class="sharebox">';
        if (!shared) {
            html += '<h3 style="margin:0 0 4px">分享这份报告</h3>' +
                '<p class="cap">链接里就带着结果，对方打开直接看到这份报告</p>' +
                '<button class="btn sm" id="r-share">生成链接</button>' +
                '<div id="r-link"></div>';
        } else {
            html += '<p class="cap" style="margin:0">这是一份分享来的报告</p>' +
                '<div style="margin-top:16px"><button class="btn sm ghost" id="r-mine">我也测一下</button></div>';
        }
        html += '<div style="margin-top:14px"><button class="linkbtn" id="r-print">打印 / 存为 PDF</button></div></div>';

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
        var bm = $('r-mine');
        if (bm) bm.onclick = function () { location.hash = ''; renderHome(); };
        $('r-print').onclick = function () { window.print(); };
    }

    /* ★ 分享来的报告没有 session，只有 id→状态。
     *   这时 path 只能现算：把所有非 M 的点按年级 + 拓扑序排出来。
     *   —— 与真实 path 的差别是没有 isRoot/isTarget 标记，
     *     因为"根因"需要会话里的 attempts 才能算准。这是有意的取舍：
     *     宁可少标两个标签，也不把不准的东西标上去。 */
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

    /* ---------------- 打开别人的报告 ---------------- */
    function openShared(code) {
        return window.ShareCode.decode(code).then(function (rep) {
            S.shared = rep;
            renderReport(rep, null, true);
        }).catch(function (e) {
            // ★ 链接坏了不能白屏，也不能假装看懂。
            //   明确说原因 + 给一个回到自己测的出口。
            $('report').innerHTML = '<div class="empty" style="padding:80px 20px">' +
                '<div style="font-size:32px;margin-bottom:14px">🔗</div>' +
                '<div style="font-size:16px;color:#12181f;margin-bottom:8px">这份报告打不开</div>' +
                '<div>' + esc(e.message) + '</div>' +
                '<div style="margin-top:24px"><button class="btn sm ghost" id="r-mine">自己去测一个</button></div></div>';
            view('v-report');
            $('r-mine').onclick = function () { location.hash = ''; renderHome(); };
        });
    }

    /* ---------------- 事件 ---------------- */
    document.addEventListener('DOMContentLoaded', function () {
        $('btn-start').onclick = start;
        $('home').onclick = function () { location.hash = ''; renderHome(); };
        $('btn-about').onclick = function () {
            toast('选章节 → 答题 → 顺着先修关系找薄弱根因');
        };
        $('btn-ac').onclick = function () { toast('账号功能开发中'); };
        init();
    });
})();
