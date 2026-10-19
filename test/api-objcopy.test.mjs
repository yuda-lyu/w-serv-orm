import fs from 'fs'
import vm from 'vm'
import util from 'util'
import { createSecretKey } from 'crypto'
import assert from 'assert'
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs'
import WServOrm from '../src/WServOrm.mjs'
import { getReject, quiet, same, mkForgedObjProto } from './tools/ormStub.mjs'


//以真ORM(w-orm-lowdb, mingo查詢)經procOrm驗證R-OBJ-01: 含整數length鍵之find與寫入列, 結果須等於以JS參考實作(預言機)算得者
//自建夾具: 資料表tabA之id為字串型pk, 各案前重新播種; 「ORM收到」為對woItems.tabA.select/delAll加spy所得之實參
let fd = './test/_tmp/api-objcopy'

let ds = { tabA: { keys: ['id', 'name', 'length'], settings: { id: { pk: true, type: 'STRING' }, name: { type: 'STRING' } } } }

let seed = [
    { id: 'a1', name: 'alpha', length: 3 },
    { id: 'a2', name: 'beta', length: 1 },
    { id: 'a3', name: 'gamma' },
    { id: 'a4', name: 'alpha', length: 'abc' },
    { id: 'a5', name: 'delta', length: 0 },
]

//refMatch, JS參考實作(系列條件白名單內之子集): 欄位等值(嚴格相等)、$and、$or、欄位層$in/$nin/$eq/$ne; 缺欄視為undefined
function refMatch(row, find) {
    let opMatch = (v, c) => {
        if (c !== null && typeof c === 'object' && !Array.isArray(c)) {
            return Object.keys(c).every((op) => {
                if (op === '$eq') return v === c[op]
                if (op === '$ne') return v !== c[op]
                if (op === '$in') return c[op].includes(v)
                if (op === '$nin') return !c[op].includes(v)
                throw new Error(`參考實作不支援${op}`)
            })
        }
        return v === c
    }
    return Object.keys(find).every((k) => {
        let c = find[k]
        if (k === '$and') return c.every((f) => refMatch(row, f))
        if (k === '$or') return c.some((f) => refMatch(row, f))
        return opMatch(row[k], c)
    })
}

let finds = [
    { length: 1, name: 'alpha' }, //無列同時符合: 修前條件消失而回全表
    { length: 1, name: 'beta' },
    { length: 0 },
    { length: 0, name: 'alpha' },
    { id: 'a1', length: 3 },
    { id: 'a1', length: 4 },
    { length: 3 },
    { length: 'abc' },
    { length: Number.MAX_SAFE_INTEGER },
    { length: 3.5 },
    { $or: [{ length: 3 }, { name: 'gamma' }] },
    { $and: [{ length: 1 }, { name: 'beta' }] },
    { length: { $ne: 3 } },
    { length: { $nin: [3, 1] } },
    { id: { $in: ['a1', 'a2'] }, length: 1 },
    { name: 'alpha' },
    {},
]


describe('R-OBJ-01 接w-orm-lowdb(以JS參考實作為預言機)', function() {

    let so = null
    let seen = []
    let proc = (mode, input) => so.procOrm('u1', 'tabA', mode, input)
    let rows = async () => (await so.woItems.tabA.select()).sort((a, b) => (a.id < b.id ? -1 : 1))
    let reseed = async () => {
        await so.woItems.tabA.delAll()
        await so.woItems.tabA.insert(structuredClone(seed))
    }

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        so = WServOrm(ds, WOrm, `${fd}/db.json`, 'worm')
        for (let fn of ['select', 'delAll']) {
            let orig = so.woItems.tabA[fn].bind(so.woItems.tabA)
            so.woItems.tabA[fn] = async (data) => {
                seen.push({ fn, data })
                return orig(data)
            }
        }
    })

    beforeEach(async function() {
        await reseed()
        seen = []
    })

    after(async function() {
        await so.closeAll()
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('A13 select: ORM收到之條件同送入者, 回傳之列集合等於參考實作', async function() {
        //R-OBJ-01 規則1; dspec 一之2①(同一find於select命中者即delAll刪除者)
        for (let find of finds) {
            seen = []
            let r = await proc('select', find)
            same(seen[0].data, find, `select ${JSON.stringify(find)} ORM收到`)
            let expected = seed.filter((v) => refMatch(v, find)).map((v) => v.id).sort()
            same(r.map((v) => v.id).sort(), expected, `select ${JSON.stringify(find)} 回傳`)
        }
    })

    it('A14 delAll: ORM收到之條件同送入者, 刪除之列集合等於參考實作(修前{length:1,name:alpha}刪3/3列)', async function() {
        //R-OBJ-01 規則1; dspec 一之2②③(不得擴大刪除範圍)
        for (let find of finds) {
            await reseed()
            seen = []
            let r = await proc('delAll', find)
            same(seen[0].data, find, `delAll ${JSON.stringify(find)} ORM收到`)
            let left = seed.filter((v) => !refMatch(v, find)).map((v) => v.id).sort()
            same((await rows()).map((v) => v.id), left, `delAll ${JSON.stringify(find)} 剩餘`)
            assert.strictEqual(r.nDeleted, seed.length - left.length, `delAll ${JSON.stringify(find)} 刪除筆數`)
        }
    })

    it('A15 寫入列含整數length欄: insert、save、mix 讀回與送入者相同, 回傳主鍵即實際主鍵', async function() {
        //R-OBJ-01 規則1: 修前 insert 含 length:3 之列內容遺失且主鍵被換成產生值, save 單筆之列不寫入而回報 {id:undefined}
        await so.woItems.tabA.delAll()
        let input = [
            { id: 'l1', name: 'x', length: 3 },
            { id: 'l2', name: 'y', length: 'abc' },
            { id: 'l3', name: 'z' },
            { name: 'noid', length: 0 },
            { id: 'l5', length: 2 },
        ]
        let r = await proc('insert', structuredClone(input))
        //已帶主鍵者須原樣(預期取自輸入, 不取自回傳: 否則被錯改主鍵時回傳與讀回一致而測不出, 外審 sol F5); 未帶者補值, 預期取自回傳
        input.forEach((v, i) => {
            if (v.id !== undefined) {
                assert.strictEqual(r[i].id, v.id, `列${i}之主鍵`)
            }
            else {
                assert.ok(typeof r[i].id === 'string' && r[i].id.length > 30, `列${i}補值`)
            }
        })
        let expected = input.map((v, i) => ({ ...v, id: v.id !== undefined ? v.id : r[i].id }))
        same(await rows(), expected.sort((a, b) => (a.id < b.id ? -1 : 1)), 'insert讀回')

        //save: 以回傳主鍵覆寫, length 改值; 單筆之列 {id, length:0} 亦須寫入
        let r2 = await proc('save', expected.map((v) => ({ ...v, length: 7 })))
        same(r2.map((v) => v.id), expected.map((v) => v.id), 'save回傳主鍵')
        same(await rows(), expected.map((v) => ({ ...v, length: 7 })).sort((a, b) => (a.id < b.id ? -1 : 1)), 'save讀回')
        let r3 = await proc('save', { id: 's1', length: 0 })
        same(r3, { id: 's1' }, 'save單筆回傳')
        assert.deepStrictEqual((await so.woItems.tabA.select({ id: 's1' })), [{ id: 's1', length: 0 }], 'save單筆讀回')
        let r4 = await proc('save', [{ id: 's2', length: 1 }])
        same(r4, [{ id: 's2' }], 'save單筆陣列回傳')
        assert.deepStrictEqual((await so.woItems.tabA.select({ id: 's2' })), [{ id: 's2', length: 1 }], 'save單筆陣列讀回')

        //mix
        await so.woItems.tabA.delAll()
        await so.woItems.tabA.insert([{ id: 'm2', name: 'old', length: 1 }])
        let rm = await proc('mix', { add: [{ id: 'm1', name: 'x', length: 2 }], diff: [{ id: 'm2', name: 'new', length: 5 }] })
        same(rm, [{ id: 'm1' }, { id: 'm2' }], 'mix回傳')
        same(await rows(), [{ id: 'm1', name: 'x', length: 2 }, { id: 'm2', name: 'new', length: 5 }], 'mix讀回')
    })

    it('A16 自有__proto__鍵: find與寫入列reject, 表內容不變(delAll不刪, insert不寫)', async function() {
        //R-OBJ-01 規則3
        let before = await rows()
        seen = []
        for (let c of ['{"__proto__":{"x":1}}', '{"id":"a1","__proto__":{"id":"zzz"}}', '{"$or":[{"__proto__":1}]}']) {
            assert.strictEqual(await quiet(() => getReject(proc('select', JSON.parse(c)))), 'invalid find of select, unsupported key[__proto__]', c)
            assert.strictEqual(await quiet(() => getReject(proc('delAll', JSON.parse(c)))), 'invalid find of delAll, unsupported key[__proto__]', c)
        }
        assert.strictEqual(await quiet(() => getReject(proc('insert', [JSON.parse('{"id":"p1","name":"x","__proto__":{"y":1}}')]))), 'failed to insert data, unsupported key[__proto__]: data[0]')
        assert.strictEqual(await quiet(() => getReject(proc('mix', { add: [{ id: 'p2' }], diff: [JSON.parse('{"id":"a1","__proto__":{}}')] }))), 'failed to update data, unsupported key[__proto__]: data[0]')
        assert.deepStrictEqual(seen, [], 'ORM之select與delAll不應被呼叫')
        same(await rows(), before, '表內容不變')
    })

    it('A17 非純物件與存取器之find: select與delAll reject, 不回全表亦不刪全表(外審 opus #4、sol F1、F2)', async function() {
        //R-INPUT-01 規則3、R-OBJ-01 規則3: 修前/D1後未擋時, 偽造Symbol.toStringTag之Map被複製成{}而刪除全表; getter讀兩次令檢查之值與使用之值不同
        let before = await rows()
        seen = []
        let forged = Object.defineProperty(new Map([['id', 'a1']]), Symbol.toStringTag, { value: 'Object' })
        class G {
            get name() {
                return 'alpha'
            }
        }
        let reads = 0
        let mkGetter = () => Object.defineProperty({}, 'id', {
            enumerable: true,
            get() {
                return ++reads === 1 ? 'a1' : 'a2'
            }
        })
        for (let [find, msg] of [
            [forged, 'need an object'],
            [new G(), 'need an object'],
            [Object.create({ name: 'alpha' }), 'need an object'],
            [mkGetter(), 'unsupported accessor property'],
        ]) {
            for (let mode of ['select', 'delAll']) {
                assert.strictEqual(await quiet(() => getReject(proc(mode, find))), `invalid find of ${mode}, ${msg}`)
            }
        }
        assert.strictEqual(reads, 0, 'getter不應被呼叫')
        assert.deepStrictEqual(seen, [], 'ORM之select與delAll不應被呼叫')
        same(await rows(), before, '表內容不變')
    })

    it('A18 woName為原型鏈名稱或路徑、find巢狀過深: 以固定字串reject, 不回全表亦不刪全表', async function() {
        //R-INPUT-01 規則5、R-OBJ-01 規則5、R-ERR-01 規則1: 修前 woName 以 TypeError 物件 reject, 約1173層$and以 RangeError 物件 reject
        let before = await rows()
        seen = []
        for (let name of ['__proto__', 'constructor', 'toString', 'tabA.select']) {
            for (let [mode, input] of [['select', {}], ['delAll', {}], ['insert', [{ id: 'z' }]], ['del', [{ id: 'a1' }]]]) {
                assert.strictEqual(await quiet(() => getReject(so.procOrm('u1', name, mode, input))), `can not find table[${name}] in ORM`, `${name} ${mode}`)
            }
        }
        let deep = { id: 'a1' }
        for (let i = 0; i < 1e4; i++) {
            deep = { $and: [deep] }
        }
        for (let mode of ['select', 'delAll']) {
            assert.strictEqual(await quiet(() => getReject(proc(mode, deep))), `invalid find of ${mode}, too deep`, mode)
        }
        assert.deepStrictEqual(seen, [], 'ORM之select與delAll不應被呼叫')
        same(await rows(), before, '表內容不變')
    })

    //R-OBJ-01 規則6(外審 sol F1 與第二輪 A-01~A-03、B-01): 位置 x 變形, 預言機為直呼真ORM(wsemi cvOrmFind白名單)
    //  must: 直呼reject => 經procOrm之select與delAll亦reject固定字串, ORM不被呼叫, 表不變
    //  ok: 直呼通過 => 經procOrm之select回傳同直呼, delAll刪除之列集合同直呼select所得
    //  superset: 直呼通過而本層仍fail-closed reject(帶標籤之真陣列等, 見帳本), ORM不被呼叫, 表不變
    let hide = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true })
    class Cls {
        constructor(o) {
            Object.assign(this, o)
        }
    }
    let msgHidden = 'unsupported symbol key or non-enumerable property'
    let msgIrreg = 'unsupported irregular object or array'
    let ids = (rs) => rs.map((v) => v.id).sort()
    //oracle: 直呼真ORM(不經procOrm); 回傳 {ok: 列id} 或 {err}
    let oracle = (find) => so.woItems.tabA.select(find).then((r) => ({ ok: ids(r) }), (e) => ({ err: e }))

    //runCell: 一格(位置 x 變形)於select與delAll之斷言; msg 為 procOrm 之 reject 字串 `invalid find of <mode>, <msg>`
    let modesRun = 0 //runCell 實際跑完之 mode 數(各案以差值斷言: 每格 2 個 mode, 防止 mode 迴圈被縮短而仍綠)
    async function runCell(label, kind, mk, msg) {
        await reseed()
        let before = await rows()
        let direct = await quiet(() => oracle(mk()))
        if (kind === 'must') {
            assert.ok(direct.err !== undefined, `${label} 預言機: 直呼ORM應reject`)
        }
        else {
            assert.ok(direct.ok !== undefined, `${label} 預言機: 直呼ORM應通過`)
        }
        //表於本格開始時重灌一次: select 不改表, must 與 superset 格之 delAll 亦不得改表(每個 mode 後皆斷言表不變), 故 mode 之間不必重灌; ok 格之 delAll 在最後
        for (let mode of ['select', 'delAll']) {
            modesRun++
            seen = []
            if (kind === 'ok') {
                let r = await proc(mode, mk())
                if (mode === 'select') {
                    same(ids(r), direct.ok, `${label} select 回傳`)
                }
                else {
                    same((await rows()).map((v) => v.id), ids(before).filter((id) => !direct.ok.includes(id)), `${label} delAll 剩餘`)
                }
                continue
            }
            let err = await quiet(() => getReject(proc(mode, mk()))).catch((e) => assert.fail(`${label} ${mode} ${e.message}`))
            let sawOrm = seen.length
            assert.strictEqual(err, `invalid find of ${mode}, ${msg}`, `${label} ${mode}`)
            assert.strictEqual(sawOrm, 0, `${label} ${mode} ORM不應被呼叫`)
            same(await rows(), before, `${label} ${mode} 表內容不變`)
        }
    }

    it('A20 find之物件節點含Symbol鍵、不可列舉鍵、類別實例、品牌物件、偽原型、帶標籤函數: 直呼ORM reject者經procOrm亦reject, 表不變(7位置 x 13變形)', async function() {
        //R-OBJ-01 規則6: 第一版修前以 tmp/verify/f1-diff.mjs 實測, 物件節點 18 格直呼reject而經procOrm通過; 外審第二輪(tmp/verify/f1-sol.mjs)另證 brand、fakeRoot、fnTag 三類
        let positions = [
            ['top', () => ({ id: 'a1' }), (n) => n],
            ['$and元素', () => ({ id: 'a1' }), (n) => ({ $and: [n] })],
            ['$or元素', () => ({ id: 'a1' }), (n) => ({ $or: [n] })],
            ['巢狀$and→$or元素', () => ({ id: 'a1' }), (n) => ({ $and: [{ $or: [n] }] })],
            ['id運算子物件($eq)', () => ({ $eq: 'a1' }), (n) => ({ id: n })],
            ['id運算子物件($in)', () => ({ $in: ['a1'] }), (n) => ({ id: n })],
            ['非id欄位運算子物件', () => ({ $eq: 'alpha' }), (n) => ({ name: n })],
        ]
        let muts = [
            ['control', 'ok', (o) => o, null],
            ['sym', 'must', (o) => Object.assign(o, { [Symbol('s')]: 1 }), msgHidden],
            ['hiddenExtra', 'must', (o) => hide(o, 'zz', 1), msgHidden],
            ['hiddenFirst', 'must', (o) => {
                let k = Object.keys(o)[0]
                let v = o[k]
                delete o[k]
                return hide(o, k, v)
            }, msgHidden],
            ['cls', 'must', (o) => new Cls(o), msgIrreg],
            ['nullProto', 'ok', (o) => Object.assign(Object.create(null), o), null],
            //內建品牌物件之原型改為null: 內部槽不在自有鍵中, 複本洗成一般物件(A-01)
            ['brand', 'must', (o) => Object.assign(Object.setPrototypeOf(new Map(), null), o), msgIrreg],
            //原型僅有constructor一鍵之偽原型: 通過lodash式純物件判準而後端要求本realm之Object.prototype或null
            ['fakeRoot', 'must', (o) => Object.assign(Object.create(Object.assign(Object.create(null), { constructor: Object })), o), msgIrreg],
            //帶Symbol.toStringTag為Object之函數: 被isobj當物件複製, 函數身分與Symbol鍵被洗掉(A-03)
            ['fnTag', 'must', (o) => Object.assign(function() {}, o, { [Symbol.toStringTag]: 'Object' }), msgIrreg],
            //外審第二輪: 仿Object.prototype之偽原型(鍵名同、constructor指向真Object, 但其prototype不指回偽原型)(A-01)
            ['fakeRoot12', 'must', (o) => Object.assign(Object.create(mkForgedObjProto()), o), msgIrreg],
            //constructor 為 getter 之偽原型(A-03): 檢查不得執行它
            ['fakeRootGetter', 'must', (o) => Object.assign(Object.create(mkForgedObjProto({ get: () => Object, enumerable: false, configurable: true })), o), msgIrreg],
            //不在 util.types 品牌清單內之可結構化複製品牌物件(KeyObject, 原型改為null, 帶自有鍵): 由 structuredClone 網抓; 後端之品牌探針清單不含 KeyObject 而接受(superset)
            ['keyObject', 'superset', (o) => Object.assign(Object.setPrototypeOf(createSecretKey(Buffer.alloc(16)), null), o), msgIrreg],
            //Proxy: 後端接受而本層一律reject(陷阱可令檢查之值不等於使用之值; superset)
            ['proxy', 'superset', (o) => new Proxy(o, {}), msgIrreg],
        ]
        let n = 0
        let m0 = modesRun
        for (let [pn, base, build] of positions) {
            for (let [mn, kind, mut, msg] of muts) {
                //頂層之非純物件(類別實例、偽原型、函數)由 getErrFind 先以 need an object 回絕
                let m = pn === 'top' && ['cls', 'fakeRoot', 'fnTag', 'fakeRoot12', 'fakeRootGetter'].includes(mn) ? 'need an object' : msg
                await runCell(`${pn} | ${mn}`, kind, () => build(mut(base())), m)
                n++
            }
        }
        assert.strictEqual(n, 91, '格數')
        assert.strictEqual(modesRun - m0, 91 * 2, '完成數(格 × 2 mode)')
    })

    it('A21 find之陣列節點含額外屬性、Symbol鍵、不可列舉元素、空洞、帶標籤: 直呼ORM reject者經procOrm亦reject, 表不變(5位置 x 12變形)', async function() {
        //R-OBJ-01 規則6: 第一版修前以 tmp/verify/f1-diff.mjs 實測, 陣列節點 20 格直呼reject而經procOrm通過; 外審第二輪另證 arrHoleInherited(A-02)、fnTagArray(A-03)、arrTagGetter(B-01)
        //arrProtoTag、arrTagGetter 直呼通過而本層仍 reject(superset: 不依標籤歸類, 且不執行標籤 getter)
        let positions = [
            ['id.$in', () => ['a1'], (n) => ({ id: { $in: n } })],
            ['id.$nin', () => ['a9'], (n) => ({ id: { $nin: n } })],
            ['非id欄位.$in', () => ['alpha'], (n) => ({ name: { $in: n } })],
            ['$and值', () => [{ id: 'a1' }], (n) => ({ $and: n })],
            ['$or值', () => [{ id: 'a1' }], (n) => ({ $or: n })],
        ]
        let tagProto = (tag) => Object.create(Array.prototype, { [Symbol.toStringTag]: { value: tag } })
        let muts = [
            ['control', 'ok', (a) => a, null],
            ['arrExtra', 'must', (a) => Object.assign(a, { extra: 1 }), msgIrreg],
            ['arrHiddenExtra', 'must', (a) => hide(a, 'extra', 1), msgIrreg],
            ['arrSym', 'must', (a) => Object.assign(a, { [Symbol('s')]: 1 }), msgIrreg],
            ['arrHole', 'must', (a) => {
                a[a.length + 1] = a[0]
                return a
            }, msgIrreg],
            ['arrHiddenEl', 'must', (a) => hide(a, '0', a[0]), msgIrreg],
            ['arrFakeTag', 'must', (a) => Object.assign({ length: a.length, [Symbol.toStringTag]: 'Array' }, a), msgIrreg],
            ['arrProtoTag', 'superset', (a) => Object.setPrototypeOf(a, tagProto('Object')), msgIrreg],
            //空洞陣列之原型帶資料索引: 檢查跳過空洞而map以array[index]讀到繼承值(A-02)
            ['arrHoleInherited', 'must', (a) => Object.setPrototypeOf(new Array(a.length), Object.assign(Object.create(Array.prototype), a)), msgIrreg],
            //標籤為繼承之getter: 分類時被執行(檢查與使用各一次, 可回傳不同值)(B-01)
            ['arrTagGetter', 'superset', (a) => Object.setPrototypeOf(a, Object.create(Array.prototype, { [Symbol.toStringTag]: { get: () => 'Array' } })), msgIrreg],
            //帶Symbol.toStringTag為Array之函數(A-03)
            ['fnTagArray', 'must', (a) => Object.assign(function() {}, a, { [Symbol.toStringTag]: 'Array' }), msgIrreg],
            //原型為Proxy之真陣列(外審第二輪 A-02): 後端接受, 本層一律reject(分類不得觸發原型之陷阱; superset)
            ['arrProtoProxy', 'superset', (a) => Object.setPrototypeOf(a, new Proxy(Array.prototype, {})), msgIrreg],
        ]
        let n = 0
        let m0 = modesRun
        for (let [pn, base, build] of positions) {
            for (let [mn, kind, mut, msg] of muts) {
                await runCell(`${pn} | ${mn}`, kind, () => build(mut(base())), msg)
                n++
            }
        }
        assert.strictEqual(n, 60, '格數')
        assert.strictEqual(modesRun - m0, 60 * 2, '完成數(格 × 2 mode)')
    })

    it('A22 sol F1 原情境: 頂層僅含不可列舉id或Symbol鍵之find, delAll不刪全表(修前剩0列), select不回全表', async function() {
        //R-OBJ-01 規則6、dspec 一之2②(無法轉譯之值必須reject, 不得擴大刪除範圍); 重現腳本 tmp/verify/f1.mjs
        let mks = [
            ['不可列舉id', () => Object.defineProperty({}, 'id', { value: 'a1', enumerable: false })],
            ['Symbol鍵', () => ({ [Symbol('s')]: 1 })],
            ['id.$in另有額外屬性(sol 另測)', () => ({ id: { $in: Object.assign(['a1'], { extra: 1 }) } })],
            ['id運算子為類別實例(sol 另測)', () => ({ id: new Cls({ $in: ['a1'] }) })],
            ['原型為null之Map(第二輪 A-01)', () => Object.setPrototypeOf(new Map([['secret', 'a2']]), null)],
            ['原型僅有constructor之偽原型(第二輪)', () => Object.create(Object.assign(Object.create(null), { constructor: Object }))],
        ]
        let done = 0
        for (let [label, mk] of mks) {
            let before = await rows()
            assert.strictEqual(before.length, seed.length)
            let direct = await quiet(() => oracle(mk()))
            assert.ok(direct.err !== undefined, `${label} 預言機: 直呼ORM應reject`)
            for (let mode of ['select', 'delAll']) {
                seen = []
                let err = await quiet(() => getReject(proc(mode, mk()))).catch((e) => assert.fail(`${label} ${mode} ${e.message}`))
                assert.ok(typeof err === 'string' && err.startsWith(`invalid find of ${mode}, `), `${label} ${mode} ${err}`)
                assert.strictEqual(seen.length, 0, `${label} ${mode} ORM不應被呼叫`)
                done++
            }
            same(await rows(), before, `${label} 表內容不變(delAll不刪)`)
        }
        assert.strictEqual(mks.length, 6, '語料數')
        assert.strictEqual(done, 6 * 2, '完成數(語料 × 2 mode)')
    })

    it('A23 壞節點在兄弟之前後與深度邊界(含品牌物件、Proxy、函數在較後位置): 皆被檢查到, 直呼ORM reject者經procOrm亦reject, 表不變(外審第二輪 C-01)', async function() {
        //R-OBJ-01 規則6: 檢查須走訪每個兄弟與每一層(變異「只遞迴第0元素」「只遞迴最後一個值」「第64層略過strict」須轉紅)
        //容器層數: 根為第1層, 每包一層 {$and:[…]} 增2層; 第65層起由深度上限先回絕(too deep)
        let bad = (o) => hide(o, 'zz', 1)
        let wrap = (inner, k) => {
            for (let i = 0; i < k; i++) {
                inner = { $and: [inner] }
            }
            return inner
        }
        let nulP = (o) => Object.setPrototypeOf(o, null)
        let keyObj = () => nulP(createSecretKey(Buffer.alloc(16)))
        let cases = [
            ['id在前壞、name在後', () => ({ id: bad({ $eq: 'a1' }), name: 'alpha' }), msgHidden],
            ['name在前壞、id在後', () => ({ name: bad({ $eq: 'alpha' }), id: 'a1' }), msgHidden],
            ['壞運算子物件夾在中間', () => ({ id: 'a1', name: bad({ $eq: 'alpha' }), length: 3 }), msgHidden],
            ['$and第二個元素壞', () => ({ $and: [{ id: 'a1' }, bad({ name: 'alpha' })] }), msgHidden],
            ['$or最後一個元素壞(共三個)', () => ({ $or: [{ id: 'a1' }, { id: 'a2' }, bad({ id: 'a3' })] }), msgHidden],
            ['巢狀$and→$or第三個元素壞', () => ({ $and: [{ id: 'a1' }, { $or: [{ id: 'a1' }, { id: 'a2' }, bad({ id: 'a3' })] }] }), msgHidden],
            ['壞元素在$and之後且有其他欄位並列', () => ({ name: 'alpha', $and: [{ id: 'a1' }, bad({ id: 'a1' })], length: 3 }), msgHidden],
            ['壞陣列在較前欄位、好陣列在後', () => ({ id: { $in: Object.assign(['a1'], { extra: 1 }) }, name: { $in: ['alpha'] } }), msgIrreg],
            ['壞陣列在較後欄位、好陣列在前', () => ({ name: { $in: ['alpha'] }, id: { $in: Object.assign(['a1'], { extra: 1 }) } }), msgIrreg],
            ['壞物件恰在第63層', () => wrap(bad({ id: 'a1' }), 31), msgHidden],
            ['壞陣列(額外屬性)恰在第64層', () => wrap({ $and: Object.assign([{ id: 'a1' }], { extra: 1 }) }, 31), msgIrreg],
            ['壞物件在第65層: 深度上限先回絕', () => wrap(bad({ id: 'a1' }), 32), 'too deep'],
            //由 util.types 或 structuredClone 網抓之品牌物件、Proxy、函數置於較後之兄弟位置(外審第二輪 C-02: 只走訪第0個鍵/元素之變異須轉紅)
            ['品牌物件(Map)為第2個鍵', () => ({ name: 'alpha', id: nulP(new Map()) }), msgIrreg],
            ['KeyObject為第2個鍵', () => ({ name: 'alpha', id: keyObj() }), msgIrreg],
            ['KeyObject為id運算子物件之第2個鍵', () => ({ id: { $eq: 'a1', $ne: keyObj() } }), msgIrreg],
            ['KeyObject為$and第2個元素', () => ({ $and: [{ id: 'a1' }, keyObj()] }), msgIrreg],
            ['KeyObject為$or第3個元素', () => ({ $or: [{ id: 'a1' }, { id: 'a2' }, keyObj()] }), msgIrreg],
            ['KeyObject為$in第2個元素', () => ({ id: { $in: ['a1', keyObj()] } }), msgIrreg],
            ['帶標籤之函數為$or第3個元素', () => ({ $or: [{ id: 'a1' }, { id: 'a2' }, Object.assign(function() {}, { id: 'a3', [Symbol.toStringTag]: 'Object' })] }), msgIrreg],
            ['Proxy為$and第2個元素', () => ({ $and: [{ id: 'a1' }, new Proxy({ id: 'a2' }, {})] }), msgIrreg, 'superset'],
            ['原型為Proxy之陣列在較後欄位', () => ({ name: { $in: ['alpha'] }, id: { $in: Object.setPrototypeOf(['a1'], new Proxy(Array.prototype, {})) } }), msgIrreg, 'superset'],
        ]
        let m0 = modesRun
        for (let [label, mk, msg, kind = 'must'] of cases) {
            await runCell(label, kind, mk, msg)
        }
        assert.strictEqual(cases.length, 21, '語料數')
        assert.strictEqual(modesRun - m0, 21 * 2, '完成數(例 × 2 mode)')
    })

    it('A24 合法特殊形狀照常(接真ORM): JSON.parse與structuredClone產生者、null原型、Date、1萬元素$in皆同直呼; 跨realm之純物件於複製位置被正規化、於不複製位置由後端決定(外審第二輪 C-03、A-05)', async function() {
        //R-OBJ-01 規則6、R-INPUT-01 規則3: 規則6之檢查不誤擋 JSON 可表達之資料與合法特殊形狀(unit-objcopy D06 僅接替身, 此處接真 lowdb)
        let big = Array.from({ length: 10000 }, (_, i) => `x${i}`)
        let oks = [
            ['JSON.parse產生者', () => JSON.parse('{"$or":[{"id":"a1"},{"name":{"$in":["alpha","beta"]}}],"length":{"$gte":1}}')],
            ['structuredClone產生者', () => structuredClone({ $and: [{ id: 'a1' }, { name: { $ne: 'beta' } }] })],
            ['null原型之$or元素與id運算子物件', () => ({ $or: [Object.assign(Object.create(null), { id: 'a1' }), { id: Object.assign(Object.create(null), { $in: ['a2'] }) }] })],
            ['Date為欄位值', () => ({ name: new Date(0) })],
            ['1萬個元素之$in', () => ({ id: { $in: big } })],
            ['合理複雜之查詢', () => ({ $and: [{ $or: [{ id: { $in: ['a1', 'a2'] } }, { name: 'gamma' }] }, { length: { $ne: 3 } }] })],
            ['空陣列之$in', () => ({ id: { $in: [] } })],
        ]
        for (let [label, mk] of oks) {
            await runCell(label, 'ok', mk, null)
        }
        //跨realm之純物件: 後端要求本realm之 Object.prototype/Array.prototype 或 null, 直呼會reject;
        //字串型主鍵表之複製位置(頂層、$and/$or元素、id運算子物件與其陣列)被複製為本realm物件(正規化, 內容等價, 不算洩漏)
        let cross = (src) => vm.runInNewContext(src)
        let norms = [
            ['頂層', () => cross('({ id: "a1" })')],
            ['$and元素', () => ({ $and: [cross('({ id: "a1" })')] })],
            ['id運算子物件', () => ({ id: cross('({ $in: ["a1", "a2"] })') })],
            ['id.$in陣列', () => ({ id: { $in: cross('["a1"]') } })],
        ]
        for (let [label, mk] of norms) {
            await reseed()
            let before = await rows()
            let expected = (await quiet(() => oracle(structuredClone(mk())))).ok //同內容之本realm物件
            assert.ok(expected !== undefined, `跨realm ${label} 預言機: 本realm等價物件應通過`)
            seen = []
            same(ids(await proc('select', mk())), expected, `跨realm ${label} select`)
            await proc('delAll', mk())
            same((await rows()).map((v) => v.id), ids(before).filter((id) => !expected.includes(id)), `跨realm ${label} delAll 剩餘`)
        }
        //不複製之位置(非id欄位之運算子物件): 原參考交後端, 由後端決定(現行 wsemi 要求本realm, 故reject; 若後端放寬則須等價); 表不變
        await reseed()
        let before = await rows()
        let find = () => ({ name: cross('({ $eq: "alpha" })') })
        let r = await quiet(() => proc('select', find()).then((x) => ({ ok: ids(x) }), (e) => ({ err: e })))
        if (r.err !== undefined) {
            assert.strictEqual(r.err, 'failed to select data', '不複製之位置由後端reject')
            same(await rows(), before, '表不變')
        }
        else {
            same(r.ok, (await quiet(() => oracle(structuredClone(find())))).ok, '後端放寬時須等價')
        }
    })

    it('A25 字串碼元總長逾品牌網預算(4,000,000)之find: 不做結構化複製, 直呼ORM的結果與經procOrm者等價(合法條件同結果、後端reject之品牌物件仍reject、表不變)', async function() {
        //R-OBJ-01 規則6 ⑥(sol 外審最終版 R3-02): 預算內走結構化複製網, 逾預算改走精確探針(WeakRef、FinalizationRegistry); 預言機為直呼真ORM
        let str = 'x'.repeat(65536)
        let bigIn = () => Array(70).fill(str) //70 x 65536 = 4.6M 碼元, 記憶體內僅一個字串
        let nul = (o) => Object.setPrototypeOf(o, null)
        let nClone = 0
        let cloneOrig = globalThis.structuredClone
        let cases = [
            ['合法: 大$in與id等值', 'ok', () => ({ id: 'a1', name: { $in: bigIn() } })],
            ['合法: $or內id與大$in', 'ok', () => ({ $or: [{ id: 'a1' }, { name: { $in: bigIn() } }] })],
            ['WeakRef於較後鍵之$and元素', 'must', () => ({ name: { $in: bigIn() }, $and: [nul(new WeakRef({}))] })],
            ['FinalizationRegistry於$or之較後兄弟', 'must', () => ({ $or: [{ name: { $in: bigIn() } }, nul(new FinalizationRegistry(() => {}))] })],
            ['Map於id運算子位置', 'must', () => ({ name: { $in: bigIn() }, id: nul(new Map([['$eq', 'a1']])) })],
            //後端實測接受(原型改為null之KeyObject視同無條件之物件): 逾預算時本層與直呼一致, 不再超集reject
            ['KeyObject於id運算子位置(後端決定)', 'oracle', () => ({ name: { $in: bigIn() }, id: nul(createSecretKey(Buffer.alloc(8))) })],
        ]
        let done = 0
        try {
            globalThis.structuredClone = (...a) => {
                nClone++
                return cloneOrig(...a)
            }
            for (let [label, kind, mk] of cases) {
                await reseed()
                let before = await rows()
                let direct = await quiet(() => oracle(mk()))
                if (kind === 'ok') {
                    assert.ok(direct.ok !== undefined, `${label} 預言機: 直呼ORM應通過`)
                }
                if (kind === 'must') {
                    assert.ok(direct.err !== undefined, `${label} 預言機: 直呼ORM應reject`)
                }
                nClone = 0
                seen = []
                let sel = await quiet(() => proc('select', mk()).then((r) => ({ ok: ids(r) }), (e) => ({ err: e })))
                assert.strictEqual(nClone, 0, `${label} 逾預算不做結構化複製`)
                let sawSel = seen.length
                if (direct.ok !== undefined) {
                    same(sel.ok, direct.ok, `${label} select 同直呼`)
                    await quiet(() => proc('delAll', mk()))
                    same((await rows()).map((v) => v.id), ids(before).filter((id) => !direct.ok.includes(id)), `${label} delAll 剩餘`)
                }
                else {
                    assert.ok(typeof sel.err === 'string', `${label} select 應以字串reject: ${sel.err}`)
                    seen = []
                    let del = await quiet(() => getReject(proc('delAll', mk())))
                    let sawDel = seen.length //須在 rows() 之前: rows() 亦經 spy
                    assert.ok(typeof del === 'string', `${label} delAll 應以字串reject`)
                    same(await rows(), before, `${label} 表內容不變`)
                    if (kind === 'must') {
                        assert.strictEqual(sel.err, `invalid find of select, ${msgIrreg}`, `${label} select 訊息`)
                        assert.strictEqual(del, `invalid find of delAll, ${msgIrreg}`, `${label} delAll 訊息`)
                        assert.strictEqual(sawSel + sawDel, 0, `${label} ORM不應被呼叫`)
                    }
                }
                done++
            }
        }
        finally {
            globalThis.structuredClone = cloneOrig
        }
        assert.strictEqual(done, cases.length, '完成數')
        assert.strictEqual(done, 6, '語料數')
    })

    it('A26 被拒之find再被呼叫端重用: 診斷輸出不執行原型上之標籤getter(其副作用會刪除id條件), 同一物件再送delAll仍reject, 表不變(直呼ORM從不讀該標籤, 只刪a1)', async function() {
        //R-OBJ-01 規則6 ⑤(sol 外審最終版 R3-01): 修前拒收之後 console.log(find) 格式化時getter被執行, find變成{}, 再送delAll即刪全表(5/5列)
        let logOrig = console.log
        console.log = (...a) => {
            util.format(...a) //同真 console.log 格式化引數後丟棄(不用 quiet: 其不格式化引數)
        }
        let reads = 0
        let mk = () => {
            let a = ['a1']
            let find = { id: { $in: a } }
            Object.setPrototypeOf(a, Object.create(Array.prototype, {
                [Symbol.toStringTag]: {
                    get() {
                        reads++
                        delete find.id
                        return 'Array'
                    },
                },
            }))
            return find
        }
        try {
            //對照: 直呼ORM從不讀該標籤, 兩次呼叫皆保留id條件, delAll只刪a1
            await reseed()
            let f0 = mk()
            same(ids(await so.woItems.tabA.select(f0)), ['a1'], '直呼 select')
            assert.ok('id' in f0, '直呼後find不變')
            await so.woItems.tabA.delAll(f0)
            same((await rows()).map((v) => v.id), ['a2', 'a3', 'a4', 'a5'], '直呼 delAll 只刪a1')
            assert.strictEqual(reads, 0, '直呼ORM不讀標籤getter')
            //經procOrm: 首次拒收, getter 不被執行, 同一物件再送delAll仍拒收, 表不變
            await reseed()
            let before = await rows()
            let f = mk()
            let e1 = await getReject(proc('select', f))
            assert.strictEqual(e1, `invalid find of select, ${msgIrreg}`)
            assert.strictEqual(reads, 0, '診斷輸出不得執行標籤getter')
            assert.ok('id' in f, '拒收後find不被改動')
            let e2 = await getReject(proc('delAll', f))
            assert.strictEqual(e2, `invalid find of delAll, ${msgIrreg}`, '同一物件再送delAll仍reject')
            assert.strictEqual(reads, 0)
            same(await rows(), before, '表內容不變(修前剩0列)')
        }
        finally {
            console.log = logOrig
        }
    })

})
