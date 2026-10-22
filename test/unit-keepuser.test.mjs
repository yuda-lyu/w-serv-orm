import assert from 'assert'
import WServOrm from '../src/WServOrm.mjs'
import getMapOrm from '../src/getMapOrm.mjs'
import { createMemOrm } from './tools/memOrm.mjs'
import { getReject, quiet } from './tools/ormStub.mjs'


//規格: w-web-sso 需求 T2①(任務 orm-run02): sso之tokens.userId是權杖擁有者而非建立者, 依擁有者分組以擁有者當procOrm之第1參數寫入會使userIdUpdate亦被記成擁有者;
//須能於insert保留列上之userId(擁有者), 同時userIdUpdate記為操作者(procOrm之第1參數); 規則帳本 R-KEEPUSER-01(rulebook_concurrency.md)
//以有狀態之記憶體ORM(test/tools/memOrm.mjs)驗證; 真後端(lowdb)見 api-keepuser.test.mjs
//
//規格句對照(spec = 派工提示詞「本輪範圍」與〈完成條件〉1):
//  K01-K03 「keepUserId:true 時保留擁有者、userIdUpdate 為操作者」「userIdUpdate、timeCreate、timeUpdate 照現行」
//  K02、K05 「列上userId為非空字串者保留, 其餘照現行以操作者補」
//  K04     「未給或 false 時行為與現行完全相同」
//  K06-K07 實作者補強(表無userId欄、clearXSS照常)
//  K08-K11 「與mustExist相同之驗證時點與方式: 未知鍵、非布林、用於不適用之mode → 於任何讀寫與擴充函數之前以固定字串reject」「無效opt於寫入前拒收」
//  K12-K13 實作者補強(擴充函數參數形狀不變、前處理改寫後之input為保留判定之依據)
//  K14     「若save時現行會覆寫userId, 一併評估」→ save現行不覆寫userId(只補userIdUpdate、timeUpdate), 故不適用而拒收

let wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let KEYS = ['id', 'name', 'userId', 'userIdUpdate', 'timeCreate', 'timeUpdate']

function mkSo(keys = KEYS) {
    let m = createMemOrm()
    let so = WServOrm({ a: { keys } }, m.WOrmMem, './unused', 'db')
    return { so, m }
}

let RE_TIME = /^\d{4}-\d{2}-\d{2}/

let MSG_BOOL = 'invalid opt of procOrm, keepUserId needs a boolean'
let MSG_MODE = 'invalid opt of procOrm, keepUserId supports only insert'


describe('procOrm opt: keepUserId 保留擁有者userId(T2①)', function() {

    let ins = (so) => (input, opt) => so.procOrm('op', 'a', 'insert', input, opt)

    it('K01 keepUserId:true: 列上userId(擁有者)保留, userIdUpdate為操作者, timeCreate與timeUpdate照現行補值; 單物件與陣列皆然', async function() {
        let { so, m } = mkSo()
        let p = ins(so)
        let r = await p([{ id: 'r1', name: 'x', userId: 'owner' }], { keepUserId: true })
        assert.deepStrictEqual(r, [{ id: 'r1' }])
        let row = m.rows('a')[0]
        assert.strict.equal(row.userId, 'owner')
        assert.strict.equal(row.userIdUpdate, 'op')
        assert.strict.equal(row.name, 'x')
        assert.ok(RE_TIME.test(row.timeCreate), row.timeCreate)
        assert.strict.equal(row.timeUpdate, row.timeCreate)

        let r2 = await p({ id: 'r2', name: 'y', userId: 'owner2' }, { keepUserId: true })
        assert.deepStrictEqual(r2, { id: 'r2' })
        let row2 = m.rows('a')[1]
        assert.strict.equal(row2.userId, 'owner2')
        assert.strict.equal(row2.userIdUpdate, 'op')
        assert.ok(RE_TIME.test(row2.timeCreate) && RE_TIME.test(row2.timeUpdate))

        //ORM之insert實際收到者即上述(非事後改寫)
        let sent = m.callsOf('insert')[0].args[0][0]
        assert.strict.equal(sent.userId, 'owner')
        assert.strict.equal(sent.userIdUpdate, 'op')
    })

    it('K02 逐列判定: 非空字串保留, 空字串、缺欄、null、undefined、數字、物件、布林皆以操作者補; 同批各列擁有者不同者各自保留', async function() {
        let { so, m } = mkSo()
        let p = ins(so)
        let rows = [
            { id: 'a1', userId: 'o1' },
            { id: 'a2' },
            { id: 'a3', userId: '' },
            { id: 'a4', userId: null },
            { id: 'a5', userId: undefined },
            { id: 'a6', userId: 5 },
            { id: 'a7', userId: { x: 1 } },
            { id: 'a8', userId: 'o8' },
            { id: 'a9', userId: true },
        ]
        await p(rows, { keepUserId: true })
        let got = Object.fromEntries(m.rows('a').map((v) => [v.id, v.userId]))
        assert.deepStrictEqual(got, { a1: 'o1', a2: 'op', a3: 'op', a4: 'op', a5: 'op', a6: 'op', a7: 'op', a8: 'o8', a9: 'op' })
        assert.strict.equal(m.rows('a').every((v) => v.userIdUpdate === 'op'), true)
        assert.strict.equal(m.rows('a').every((v) => RE_TIME.test(v.timeCreate) && RE_TIME.test(v.timeUpdate)), true)
    })

    it('K03 呼叫端給之userIdUpdate、timeCreate、timeUpdate仍被覆寫(照現行, keepUserId只影響userId)', async function() {
        let { so, m } = mkSo()
        await ins(so)([{ id: 'r1', userId: 'owner', userIdUpdate: 'forged', timeCreate: '1999-01-01', timeUpdate: '1999-01-02' }], { keepUserId: true })
        let row = m.rows('a')[0]
        assert.strict.equal(row.userId, 'owner')
        assert.strict.equal(row.userIdUpdate, 'op')
        assert.notStrictEqual(row.timeCreate, '1999-01-01')
        assert.notStrictEqual(row.timeUpdate, '1999-01-02')
        assert.ok(RE_TIME.test(row.timeCreate) && row.timeCreate.slice(0, 4) >= '2026')
    })

    //K04、K04b共用: 預期為固定值(非與自身對照)
    async function checkSameAsCurrent(args) {
        let { so, m } = mkSo()
        await so.procOrm('op', 'a', 'insert', [{ id: 'r1', name: 'x', userId: 'owner' }, { id: 'r2' }], ...args)
        let rows = m.rows('a')
        assert.deepStrictEqual(rows.map((v) => [v.id, v.userId, v.userIdUpdate]), [['r1', 'op', 'op'], ['r2', 'op', 'op']], JSON.stringify(args))
        let sent = m.callsOf('insert')[0].args[0]
        assert.deepStrictEqual(sent.map((v) => v.userId), ['op', 'op'])
        assert.strict.equal(m.callsOf('insert').length, 1)
        assert.strict.equal(m.callsOf('select').length, 0)
    }

    it('K04 未給opt、opt為undefined或null、{}、{mustExist:false}: 行為與現行完全相同(列上userId被操作者覆寫), ORM收到之列同(修前(HEAD)即綠, 為既有行為不變之獨立證據)', async function() {
        for (let args of [[], [undefined], [null], [{}], [{ mustExist: false }]]) {
            await checkSameAsCurrent(args)
        }
    })

    it('K04b {keepUserId:false}(單獨或與mustExist:false併用): 行為與現行完全相同(列上userId被操作者覆寫)', async function() {
        for (let args of [[{ keepUserId: false }], [{ keepUserId: false, mustExist: false }]]) {
            await checkSameAsCurrent(args)
        }
    })

    it('K05 繼承或不可列舉之userId視為未提供(與主鍵只認自有可列舉資料屬性同), 以操作者補; 自有可列舉者保留', async function() {
        let { so, m } = mkSo()
        let inh = Object.create({ userId: 'proto-owner' })
        inh.id = 'i1'
        let hid = { id: 'i2' }
        Object.defineProperty(hid, 'userId', { value: 'hidden-owner', enumerable: false, configurable: true, writable: true })
        let own = { id: 'i3', userId: 'own-owner' }
        await ins(so)([inh, hid, own], { keepUserId: true })
        let got = Object.fromEntries(m.rows('a').map((v) => [v.id, v.userId]))
        assert.deepStrictEqual(got, { i1: 'op', i2: 'op', i3: 'own-owner' })
    })

    it('K06 表無userId欄: keepUserId:true無效果(不補userId亦不刪除列上之userId, 同未帶opt); userIdUpdate仍為操作者', async function() {
        let { so, m } = mkSo(['id', 'name', 'userIdUpdate', 'timeUpdate'])
        await ins(so)([{ id: 'r1', userId: 'x' }], { keepUserId: true })
        await ins(so)([{ id: 'r2', userId: 'x' }])
        let rows = m.rows('a')
        assert.deepStrictEqual(rows.map((v) => [v.id, v.userId, v.userIdUpdate]), [['r1', 'x', 'op'], ['r2', 'x', 'op']])
    })

    it('K07 保留之userId仍經clearXSS(與其他字串欄位同); 單純空白字串屬非空字串而保留', async function() {
        let { so, m } = mkSo()
        await ins(so)([{ id: 'r1', userId: 'o<script>alert(1)</script>wner' }, { id: 'r2', userId: ' ' }], { keepUserId: true })
        let rows = m.rows('a')
        assert.ok(rows[0].userId.indexOf('<script>') < 0, rows[0].userId)
        assert.ok(rows[0].userId !== 'op' && rows[0].userId.indexOf('wner') >= 0, rows[0].userId)
        assert.strict.equal(rows[1].userId, ' ')
    })

    it('K08 keepUserId非布林(字串、數字、null、undefined值、陣列、物件、函數、存取器) → 固定字串reject, ORM 0次呼叫', async function() {
        let { so, m } = mkSo()
        let acc = {}
        Object.defineProperty(acc, 'keepUserId', { get: () => true, enumerable: true })
        let accNoVal = {}
        Object.defineProperty(accNoVal, 'keepUserId', { get: undefined, set: undefined, enumerable: true })
        let cases = [{ keepUserId: 'true' }, { keepUserId: 1 }, { keepUserId: 0 }, { keepUserId: null }, { keepUserId: undefined }, { keepUserId: [] }, { keepUserId: {} }, { keepUserId: () => true }, acc, accNoVal]
        for (let opt of cases) {
            let err = await quiet(() => getReject(ins(so)([{ id: 'n1', userId: 'o' }], opt)))
            assert.strict.equal(err, MSG_BOOL, String(JSON.stringify(opt)))
        }
        assert.strict.equal(m.calls.length, 0)
        assert.strict.equal(m.tables.a === undefined || m.tables.a.size === 0, true)
    })

    it('K09 keepUserId:true只適用insert: save、del、select、delAll、mix與無效mode皆固定字串reject且ORM 0次呼叫、庫內不變; keepUserId:false於各mode無效果', async function() {
        let { so, m } = mkSo()
        await so.procOrm('op', 'a', 'save', [{ id: 'r1', name: 'A', userId: 'o' }])
        let before = JSON.stringify(m.rows('a'))
        m.reset()
        let inputs = { save: [{ id: 'r1', name: 'B', userId: 'o' }], del: [{ id: 'r1' }], select: {}, delAll: {}, mix: { add: [{ id: 'm1' }] }, bogus: [] }
        for (let mode of Object.keys(inputs)) {
            let err = await quiet(() => getReject(so.procOrm('op', 'a', mode, inputs[mode], { keepUserId: true })))
            assert.strict.equal(err, MSG_MODE, mode)
        }
        assert.strict.equal(m.calls.length, 0)
        assert.strict.equal(JSON.stringify(m.rows('a')), before)

        //keepUserId:false於各mode無效果(沿用既有各mode之行為與回傳)
        let f = { keepUserId: false }
        assert.deepStrictEqual((await so.procOrm('op', 'a', 'select', {}, f)).map((v) => v.id), ['r1'])
        assert.deepStrictEqual(await so.procOrm('op', 'a', 'save', [{ id: 'r1', name: 'B', userId: 'o' }], f), [{ id: 'r1' }])
        assert.deepStrictEqual(await so.procOrm('op', 'a', 'mix', { add: [{ id: 'm1' }] }, f), [{ id: 'm1' }])
        assert.deepStrictEqual(await so.procOrm('op', 'a', 'del', [{ id: 'm1' }], f), [{ n: 1, nDeleted: 1, ok: 1 }])
        assert.strict.equal(await quiet(() => getReject(so.procOrm('op', 'a', 'bogus', [], f))), 'invalid mode: bogus')
        assert.deepStrictEqual(await so.procOrm('op', 'a', 'delAll', {}, f), { n: 1, nDeleted: 1, ok: 1 })
    })

    it('K10 與mustExist及其他鍵之組合: 型別先於mode檢查; 未知鍵(含拼錯、symbol鍵)reject; keepUserId:true加mustExist:false於insert可用', async function() {
        let { so, m } = mkSo()
        await so.procOrm('op', 'a', 'save', [{ id: 'r1', name: 'A' }])
        m.reset()
        let sym = { keepUserId: true, [Symbol('x')]: 1 }
        let cases = [
            ['insert', { mustExist: true, keepUserId: true }, 'invalid opt of procOrm, mustExist supports only save and del'],
            ['save', { mustExist: true, keepUserId: true }, MSG_MODE],
            ['save', { mustExist: true, keepUserId: 'x' }, MSG_BOOL],
            ['insert', { mustExist: 'x', keepUserId: true }, 'invalid opt of procOrm, mustExist needs a boolean'],
            ['insert', { keepUserId: true, extra: 1 }, 'invalid opt of procOrm, unsupported key'],
            ['insert', { keepuserid: true }, 'invalid opt of procOrm, unsupported key'],
            ['insert', { keepUserID: true }, 'invalid opt of procOrm, unsupported key'],
            ['insert', sym, 'invalid opt of procOrm, unsupported key'],
            ['insert', 'keepUserId', 'invalid opt of procOrm, need an object'],
            ['insert', [], 'invalid opt of procOrm, need an object'],
        ]
        for (let [mode, opt, msg] of cases) {
            let input = mode === 'insert' ? [{ id: 'n1', userId: 'o' }] : [{ id: 'r1', name: 'Z' }]
            let err = await quiet(() => getReject(so.procOrm('op', 'a', mode, input, opt)))
            assert.strict.equal(err, msg, `${mode} ${Object.keys(opt).map(String).join(',')}`)
        }
        assert.strict.equal(m.calls.length, 0)
        let r = await so.procOrm('op', 'a', 'insert', [{ id: 'n2', userId: 'o2' }], { keepUserId: true, mustExist: false })
        assert.deepStrictEqual(r, [{ id: 'n2' }])
        assert.strict.equal(m.rows('a').find((v) => v.id === 'n2').userId, 'o2')
        //mustExist既有行為不受影響: save + mustExist:true仍只改不增
        let err = await quiet(() => getReject(so.procOrm('op', 'a', 'save', [{ id: 'ghost' }], { mustExist: true })))
        assert.strict.equal(err, 'rowNotFound')
    })

    it('K11 直接使用getMapOrm(不經getProc)亦同: 保留、預設覆寫、無效opt於ORM呼叫之前reject', async function() {
        let m = createMemOrm()
        let ds = { a: { keys: KEYS } }
        let mapOrm = getMapOrm(ds, { a: m.WOrmMem({ cl: 'a' }) })
        await mapOrm('op', 'a', 'insert', [{ id: 'r1', userId: 'o1' }, { id: 'r2' }], { keepUserId: true })
        await mapOrm('op', 'a', 'insert', [{ id: 'r3', userId: 'o3' }])
        assert.deepStrictEqual(m.rows('a').map((v) => [v.id, v.userId, v.userIdUpdate]), [['r1', 'o1', 'op'], ['r2', 'op', 'op'], ['r3', 'op', 'op']])
        m.reset()
        assert.strict.equal(await quiet(() => getReject(mapOrm('op', 'a', 'insert', [{ id: 'x' }], { keepUserId: 1 }))), MSG_BOOL)
        assert.strict.equal(await quiet(() => getReject(mapOrm('op', 'a', 'save', [{ id: 'r1' }], { keepUserId: true }))), MSG_MODE)
        assert.strict.equal(m.calls.length, 0)
    })

    it('K12 無效opt先於擴充函數驗證: 註冊有副作用之check與前處理時, keepUserId非布林與用於非insert皆固定字串拒收, 擴充函數0次呼叫、ORM 0次呼叫; 有效opt時check照常先執行', async function() {
        let { so, m } = mkSo()
        let called = []
        so.addFunCheck(() => {
            called.push('check')
            throw new Error('check would reject first')
        })
        so.addFunPreProcessing(async (x) => {
            called.push('pre')
            await so.woItems.a.save({ id: 'side-effect' })
            return { input: x.input }
        })
        await wait(5)
        m.reset()
        for (let opt of [{ keepUserId: 'true' }, { keepUserId: 1 }, { keepuserid: true }]) {
            let err = await quiet(() => getReject(so.procOrm('op', 'a', 'insert', [{ id: 'r1' }], opt)))
            assert.ok(/^invalid opt of procOrm, /.test(err), String(err))
        }
        for (let mode of ['save', 'del', 'select', 'delAll', 'mix']) {
            let err = await quiet(() => getReject(so.procOrm('op', 'a', mode, mode === 'mix' ? { add: [] } : [], { keepUserId: true })))
            assert.strict.equal(err, MSG_MODE, mode)
        }
        assert.deepStrictEqual(called, [])
        assert.strict.equal(m.calls.length, 0)
        let err2 = await quiet(() => getReject(so.procOrm('op', 'a', 'insert', [{ id: 'r1' }], { keepUserId: true })))
        assert.strict.equal(err2.message, 'check would reject first')
        assert.deepStrictEqual(called, ['check'])
    })

    it('K13 擴充函數(check、前處理、後處理)之參數物件不含opt(鍵集合同舊介面); 前處理改寫後之input為保留判定之依據', async function() {
        let { so, m } = mkSo()
        let seen = []
        so.addFunCheck((x) => {
            seen.push(`check:${Object.keys(x).sort().join(',')}`)
        })
        so.addFunPreProcessing((x) => {
            seen.push(`pre:${Object.keys(x).sort().join(',')}`)
            return { input: x.input.map((v) => ({ ...v, userId: 'hook-owner' })) }
        })
        so.addFunPostProcessing((x) => {
            seen.push(`post:${Object.keys(x).sort().join(',')}`)
            return x.output
        })
        await wait(5)
        let r = await so.procOrm('op', 'a', 'insert', [{ id: 'r1' }], { keepUserId: true })
        assert.deepStrictEqual(r, [{ id: 'r1' }])
        let base = 'input,mode,userId,woName'
        assert.deepStrictEqual(seen, [`check:${base}`, `pre:${base}`, `post:input,mode,output,userId,woName`])
        let row = m.rows('a')[0]
        assert.strict.equal(row.userId, 'hook-owner', '前處理補之userId為進入ORM前之列上值, 被保留')
        assert.strict.equal(row.userIdUpdate, 'op')
        //未帶opt時前處理補之userId同樣被操作者覆寫(現行)
        await so.procOrm('op', 'a', 'insert', [{ id: 'r2' }])
        assert.strict.equal(m.rows('a')[1].userId, 'op')
    })

    it('K14 save現行不覆寫userId(只補userIdUpdate、timeUpdate): 列上userId原樣寫入, 故keepUserId不適用save(K09拒收); 本案鎖定save之現行行為', async function() {
        let { so, m } = mkSo()
        await so.procOrm('creator', 'a', 'insert', [{ id: 'r1', name: 'A', userId: 'owner' }], { keepUserId: true })
        assert.strict.equal(m.rows('a')[0].userId, 'owner')
        await so.procOrm('editor', 'a', 'save', [{ id: 'r1', name: 'B', userId: 'owner' }])
        let row = m.rows('a')[0]
        assert.strict.equal(row.userId, 'owner')
        assert.strict.equal(row.userIdUpdate, 'editor')
        assert.strict.equal(row.name, 'B')
        //save之列未帶userId: 不補操作者(現行), 庫內以ORM之save語意合併(memOrm為合併)而保留擁有者
        await so.procOrm('editor2', 'a', 'save', [{ id: 'r1', name: 'C' }])
        let row2 = m.rows('a')[0]
        assert.strict.equal(row2.userId, 'owner')
        assert.strict.equal(row2.userIdUpdate, 'editor2')
        let sent = m.callsOf('save').map((c) => c.args[0][0])
        assert.strict.equal('userId' in sent[1], false, 'save未對未帶userId之列補userId')
    })

})
