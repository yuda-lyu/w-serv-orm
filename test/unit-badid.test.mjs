import assert from 'assert'
import WServOrm from '../src/WServOrm.mjs'
import { createStub, getReject, quiet } from './tools/ormStub.mjs'
import { addHook } from './tools/hookKit.mjs'
import { BAD, ENTRIES } from './tools/badIds.mjs'


//規格: 第568項(與w-orm-*全族第557項規則一對齊): procOrm對「主鍵給了而無效」者整批reject, 不得靜默換成新產生之主鍵寫入
//規則帳本 R-ID-01 規則 5(給了而無效即拒絕)、規則 1(未帶僅undefined、null、''與鍵不存在)、R-ID-02(有限數字依schema轉字串, 不變)、R-OBJ-01 規則 7 ①(繼承或不可列舉之id視為未提供)
//dspec〈輸入參數之檢測機制〉V19(固定詞彙)、V20(不回顯值)、§11 W-20(判斷只收原始值, 包裝物件無效)
//以替身ORM驗證: 被拒者ORM一次都不被呼叫(不寫入任何一筆); 真ORM見 api-badid.test.mjs
//
//規格句對照:
//  B01 規則5「給了而無效之主鍵(型別全集)於insert、save、mix.add、mix.diff整批reject, 列出位置」
//  B02 規則1「未帶(undefined、null、''、鍵不存在)與有效主鍵(非空字串、有限數字轉字串)照既有補主鍵或寫入」
//  B03 R-OBJ-01 規則7 ①「繼承或不可列舉之id視為未提供」
//  B04 §11 W-20「包裝物件無效, 不得拆成原始值」
//  B05 規則1「適用條件: 主鍵欄為id、標為pk、型別為字串型或未知; 整數型等不補值亦不檢查」
//  B06 規則5「刪除通道(del、mix.del)不變, 交後端逐筆處置」
//  B07 V20「訊息與診斷不回顯值」
//  B08 R-INPUT-01 規則4「檢查之順序: 先形狀與鍵檢查, 後主鍵檢查」
//  B09 擴充函數(前處理)產生之列亦受檢
//  B10 mix之add與diff同時有誤時, 兩段訊息皆列

let st = createStub()

let dsStr = { tests: { keys: ['id', 'name'], settings: { id: { pk: true, type: 'STRING' }, name: { type: 'STRING' } } } }
let dsUnknown = { tests: { keys: ['id', 'name'] } }
let dsInt = { tests: { keys: ['id', 'name'], settings: { id: { pk: true, type: 'INTEGER' }, name: { type: 'STRING' } } } }
let dsNoId = { tests: { keys: ['name'] } }
let isGen = (v) => typeof v === 'string' && v.length > 30

//BAD(給了而無效之主鍵值全集)與ENTRIES(四個寫入入口)見 test/tools/badIds.mjs


describe('第568項: 主鍵給了而無效者整批拒絕, 不補新主鍵(R-ID-01 規則5)', function() {

    beforeEach(function() {
        st.reset()
    })

    it('B01 四個寫入入口 x 給了而無效之各型別: 整批reject並列位置, ORM一次都不被呼叫', async function() {
        //規則5: 批次[有效, 無效, 未帶, 無效]依序之第1、3筆為無效, 訊息 `<msg>, invalid id: data[1], data[3]`, 有效與未帶之列亦不寫入
        for (let ds of [dsStr, dsUnknown]) {
            let so = WServOrm(ds, st.WOrmStub, 'u', 'd')
            for (let en of ENTRIES) {
                for (let [label, mk] of BAD) {
                    st.calls.length = 0
                    let rows = [{ id: 'v1', name: 'n0' }, { id: mk(), name: 'n1' }, { name: 'n2' }, { id: mk(), name: 'n3' }]
                    let err = await quiet(() => getReject(en.run(so, rows)))
                    assert.strictEqual(err, `${en.msg}, invalid id: data[1], data[3]`, `${en.name} ${label}`)
                    assert.strictEqual(st.calls.length, 0, `${en.name} ${label}: ORM被呼叫`)
                }
            }
        }
    })

    it('B01b 單一物件與單筆陣列之輸入: 同樣拒絕, 位置為data[0]', async function() {
        //規則5: 單一物件視為第0筆(同not an object之慣例); mix之add、diff只收陣列
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        for (let [label, mk] of BAD) {
            for (let en of ENTRIES.slice(0, 2)) {
                let e1 = await quiet(() => getReject(en.run(so, { id: mk(), name: 'n0' })))
                assert.strictEqual(e1, `${en.msg}, invalid id: data[0]`, `${en.name} one ${label}`)
                let e2 = await quiet(() => getReject(en.run(so, [{ id: mk(), name: 'n0' }])))
                assert.strictEqual(e2, `${en.msg}, invalid id: data[0]`, `${en.name} arr ${label}`)
            }
            for (let en of ENTRIES.slice(2)) {
                let e2 = await quiet(() => getReject(en.run(so, [{ id: mk(), name: 'n0' }])))
                assert.strictEqual(e2, `${en.msg}, invalid id: data[0]`, `${en.name} arr ${label}`)
            }
        }
        assert.strictEqual(st.calls.length, 0)
    })

    it('B01c 失敗位置超過10筆者只列前10筆並附總筆數(同R-MSG-01 規則3)', async function() {
        //規則5沿用getMsgFail之格式
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        let rows = Array.from({ length: 12 }, (v, k) => ({ id: k % 2 === 0 ? true : 'ok' + k, name: 'n' + k }))
        rows.push(...Array.from({ length: 7 }, (v, k) => ({ id: false, name: 'm' + k })))
        let err = await quiet(() => getReject(so.procOrm('u1', 'tests', 'insert', rows)))
        assert.strictEqual(err, 'failed to insert data, invalid id: data[0], data[2], data[4], data[6], data[8], data[10], data[12], data[13], data[14], data[15], ... (13 in total)')
        assert.strictEqual(st.calls.length, 0)
    })

    it('B02 未帶(undefined、null、空字串、鍵不存在)照補主鍵, 有效主鍵(非空字串、有限數字)照寫入, 四個入口皆然', async function() {
        //規則1、R-ID-02: 此為既有行為, 本輪不變; 空白字串為非空字串(有效)
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        for (let en of ENTRIES) {
            st.calls.length = 0
            let rows = [
                { id: 'v1', name: 'n0' },
                { id: 5, name: 'n1' },
                { id: null, name: 'n2' },
                { id: '', name: 'n3' },
                { id: undefined, name: 'n4' },
                { name: 'n5' },
                { id: ' ', name: 'n6' },
                { id: 1.5, name: 'n7' },
                { id: 0, name: 'n8' },
                { id: -3, name: 'n9' },
            ]
            let r = await en.run(so, rows)
            let data = st.calls[0].data
            let ids = data.map((v) => v.id)
            assert.deepStrictEqual(data.map((v) => v.name), ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'], en.name)
            assert.strictEqual(ids[0], 'v1', en.name)
            assert.strictEqual(ids[1], '5', en.name)
            assert.ok([2, 3, 4, 5].every((k) => isGen(ids[k])), `${en.name} ${JSON.stringify(ids)}`)
            assert.strictEqual(new Set(ids.slice(2, 6)).size, 4, `${en.name}: 補出之主鍵須各異`)
            assert.deepStrictEqual([ids[6], ids[7], ids[8], ids[9]], [' ', '1.5', '0', '-3'], en.name)
            assert.deepStrictEqual(r.map((v) => v.id), ids, en.name)
        }
    })

    it('B03 繼承或不可列舉之id視為未提供: 補主鍵寫入, 不拒絕(R-OBJ-01 規則7 ①不變)', async function() {
        //只有自有可列舉之資料屬性算「給了」; 繼承者與不可列舉者(即使其值為無效型別)視為未提供
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        for (let en of ENTRIES) {
            st.calls.length = 0
            let rows = [
                Object.assign(Object.create({ id: true }), { name: 'n0' }),
                Object.assign(Object.create({ id: 123 }), { name: 'n1' }),
                Object.defineProperty({ name: 'n2' }, 'id', { value: {}, enumerable: false }),
                Object.defineProperty({ name: 'n3' }, 'id', { value: false, enumerable: false }),
            ]
            let r = await en.run(so, rows)
            let ids = st.calls[0].data.map((v) => v.id)
            assert.ok(ids.every(isGen), `${en.name} ${JSON.stringify(ids)}`)
            assert.strictEqual(new Set(ids).size, 4, en.name)
            assert.deepStrictEqual(r.map((v) => v.id), ids, en.name)
        }
    })

    it('B04 包裝物件不被拆成原始值: new String(\'a\')拒絕而非寫成\'a\', new Number(5)拒絕而非補主鍵或轉\'5\'', async function() {
        //W-20: 判斷只收原始值, 包裝物件無效; 修前寫入複製(wsemi clearXSS)會把String包裝物件拆成原始值 'a' 而當有效主鍵寫入
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        let wrapS = new String('a') // eslint-disable-line no-new-wrappers
        let wrapN = new Number(5) // eslint-disable-line no-new-wrappers
        for (let en of ENTRIES) {
            for (let [label, w] of [['String', wrapS], ['Number', wrapN]]) {
                let row = { id: w, name: 'n0' }
                let err = await quiet(() => getReject(en.run(so, [row])))
                assert.strictEqual(err, `${en.msg}, invalid id: data[0]`, `${en.name} ${label}`)
                assert.strictEqual(row.id, w, '呼叫端之物件不被改動')
            }
        }
        assert.strictEqual(st.calls.length, 0, 'ORM未收到任何數據(含被拆出之a)')
        assert.ok(wrapS instanceof String && wrapN instanceof Number)
    })

    it('B05 適用範圍: 主鍵欄為整數型或表無id欄者不檢查(原樣交ORM, 同R-ID-01 規則1之不補值)', async function() {
        //規則1: isPkIdString為假者本層不補值亦不轉型, 型別由後端依其主鍵欄型別契約處置
        for (let ds of [dsInt, dsNoId]) {
            st.calls.length = 0
            let so = WServOrm(ds, st.WOrmStub, 'u', 'd')
            for (let en of ENTRIES) {
                let a = { id: true, name: 'n0' }
                let r = await en.run(so, [a])
                let got = st.calls[st.calls.length - 1].data[0]
                assert.strictEqual(got.id, true, `${JSON.stringify(ds)} ${en.name}`)
                assert.strictEqual(r.length, 1)
            }
            assert.strictEqual(st.calls.length, ENTRIES.length)
        }
    })

    it('B06 刪除通道不變: del與mix.del之無效主鍵原樣交ORM, 由ORM逐筆處置', async function() {
        //規則5: del不補主鍵, 無效者後端回ok:0, 本層以既有格式 `failed to delete data: <位置>` reject(R-PERITEM-01); 本層不另拒絕
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        let bads = [true, {}, [], NaN, new String('a')] // eslint-disable-line no-new-wrappers
        for (let bad of bads) {
            st.calls.length = 0
            await so.procOrm('u1', 'tests', 'del', [{ id: bad }])
            await so.procOrm('u1', 'tests', 'mix', { del: [{ id: bad }] })
            assert.deepStrictEqual(st.calls.map((c) => c.fn), ['del', 'del'])
            assert.ok(st.calls.every((c) => Object.is(c.data[0].id, bad)), '原樣交ORM(含包裝物件不被拆; NaN以Object.is比較)')
        }
        //後端以ok:0逐筆回報之既有通道見 api-badid.test.mjs(真ORM)
    })

    it('B07 訊息與診斷不回顯值(V20): reject字串與funLog皆不含被拒之主鍵內容', async function() {
        //規則5(固定詞彙); R-DIAG-01: 診斷預設只列筆數與位置, 細節為位置清單
        let logs = []
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd', { logDetail: true, funLog: (...a) => logs.push(a) })
        let secrets = [{ secret: 'S3CR3T-obj' }, ['S3CR3T-arr'], Symbol('S3CR3T-sym'), Object(Symbol('S3CR3T-wsym')), new String('S3CR3T-str')] // eslint-disable-line no-new-wrappers
        for (let en of ENTRIES) {
            for (let sec of secrets) {
                let err = await getReject(en.run(so, [{ id: sec, name: 'n0' }]))
                assert.ok(!String(err).includes('S3CR3T'), `${en.name}: ${err}`)
            }
        }
        let text = JSON.stringify(logs, (k, v) => (typeof v === 'bigint' ? String(v) : v))
        assert.ok(!text.includes('S3CR3T'), 'funLog收到之內容不含被拒之值')
        assert.ok(logs.length > 0 && logs.every((l) => l[0].includes('invalid id')), `診斷標籤: ${JSON.stringify(logs.map((l) => l[0]))}`)
        assert.strictEqual(st.calls.length, 0)
    })

    it('B08 檢查順序: 形狀與鍵檢查先於主鍵檢查, 同批其一不為物件時回報not an object, 含自有__proto__鍵者回報該鍵', async function() {
        //R-INPUT-01 規則4: 檢查順序; 後出之檢查不覆蓋先出者(單一訊息)
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        let e1 = await quiet(() => getReject(so.procOrm('u1', 'tests', 'insert', [{ id: true }, 'x'])))
        assert.strictEqual(e1, 'failed to insert data, not an object: data[1]')
        let e2 = await quiet(() => getReject(so.procOrm('u1', 'tests', 'save', [{ id: true }, JSON.parse('{"id":"k","__proto__":{"a":1}}')])))
        assert.ok(e2.startsWith('failed to save data, unsupported key[__proto__]'), e2)
        let e3 = await quiet(() => getReject(so.procOrm('u1', 'tests', 'insert', [{ id: 'a<b', name: 'x' }, { id: true }])))
        assert.strictEqual(e3, 'failed to insert data, invalid id: data[1]', '字串主鍵含標記者與無效主鍵同批: 先出之訊息為無效主鍵(位置data[1])')
        assert.strictEqual(st.calls.length, 0)
    })

    it('B09 擴充函數(前處理)產生之無效主鍵亦拒絕, ORM不被呼叫', async function() {
        //規則5: 檢查位於mapOrm, 擴充函數之前處理在其之前執行, 其產出之列與呼叫端之列同樣受檢
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        await addHook(so, 'addFunPreProcessing', ({ input }) => ({ input: [...input, { id: {}, name: 'hook' }] }))
        let err = await quiet(() => getReject(so.procOrm('u1', 'tests', 'insert', [{ id: 'a1', name: 'n0' }])))
        assert.strictEqual(err, 'failed to insert data, invalid id: data[1]')
        assert.strictEqual(st.calls.length, 0)
    })

    it('B10 mix之add與diff同時有誤: 兩段訊息皆列(以; 串接), 位置各自為data[k]', async function() {
        //規則5: 同R-XSS-01之mix整批拒絕格式(msgsIdXSS)
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        let err = await quiet(() => getReject(so.procOrm('u1', 'tests', 'mix', {
            add: [{ id: 'a1', name: 'n0' }, { id: true, name: 'n1' }],
            del: [{ id: 'd1' }],
            diff: [{ id: [], name: 'n2' }, { id: 'f1', name: 'n3' }],
        })))
        assert.strictEqual(err, 'failed to insert data, invalid id: data[1]; failed to update data, invalid id: data[0]')
        assert.strictEqual(st.calls.length, 0, 'del亦不執行')
    })

    it('B12 save + opt.mustExist: 無效主鍵先於存在檢查被拒(不呼叫select), 未帶主鍵者維持rowNotFound', async function() {
        //R-ONLYMOD-01 規則3: 未帶主鍵者補主鍵後查無 → rowNotFound(不變); 給了而無效者 → R-ID-01 規則5 整批拒絕(原亦補新主鍵而查無 → rowNotFound, 現為invalid id)
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        let e1 = await quiet(() => getReject(so.procOrm('u1', 'tests', 'save', [{ id: true, name: 'n0' }], { mustExist: true })))
        assert.strictEqual(e1, 'failed to save data, invalid id: data[0]')
        assert.strictEqual(st.calls.length, 0, '不呼叫select與save')
        let e2 = await quiet(() => getReject(so.procOrm('u1', 'tests', 'save', [{ name: 'n1' }], { mustExist: true })))
        assert.strictEqual(e2, 'rowNotFound')
        assert.deepStrictEqual(st.calls.map((c) => c.fn), ['select'], '未帶者仍走存在檢查')
    })

    it('B13 id為已撤銷之Proxy: 仍整批reject且ORM不被呼叫(由更早之R-OBJ-01檢查回unreadable value, 非invalid id)', async function() {
        //規則5與檢查順序: R-OBJ-01之列內走訪在主鍵檢查之前, 讀已撤銷之Proxy即拋錯而回固定句 unreadable value; 結果同為整批拒絕、零寫入
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        for (let en of ENTRIES) {
            let rv = Proxy.revocable({}, {})
            rv.revoke()
            let err = await quiet(() => getReject(en.run(so, [{ id: rv.proxy, name: 'n0' }])))
            assert.strictEqual(err, `${en.msg}, unreadable value: data[0]`, en.name)
        }
        assert.strictEqual(st.calls.length, 0)
    })

    it('B11 被拒時呼叫端之物件與陣列不被改動(無補出之主鍵、無轉型)', async function() {
        //R-ID-01 規則2: 不改呼叫端之物件
        let so = WServOrm(dsStr, st.WOrmStub, 'u', 'd')
        let rows = [{ id: 7, name: 'n0' }, { id: true, name: 'n1' }, { name: 'n2' }]
        let copy = [{ id: 7, name: 'n0' }, { id: true, name: 'n1' }, { name: 'n2' }]
        await quiet(() => getReject(so.procOrm('u1', 'tests', 'insert', rows)))
        assert.deepStrictEqual(rows, copy)
    })

})
