import fs from 'fs'
import vm from 'vm'
import assert from 'assert'
import { fileURLToPath } from 'url'
import { BASELINE_VERSION, BASELINE_REJECT, cyrb53, checkContract, digestRow, buildBaseline, isBaselineValid, compareBaseline, pickWriteRow, getRejectKey } from '../src/baseline.mjs'


//規格: 多人同時編輯之寫入契約 §5、§6(列摘要h1、基準、比對); 規則帳本 R-BASELINE-01
//每條正規化與排序規則至少一正一反; 同構(Node與無Node全域之vm)與零import之靜態檢查置於末尾
//
//規格句對照(spec = C:\opensrcOper\dspec\多人同時編輯之寫入契約.md):
//  D01 §5「取 contract.fields, 依宣告之序」  D02 §5「orderKey 不在其內」、§3 serverOnly「不入基準」  D03 §5「undefined/null/'' → 同一空值」
//  D04 §5「Date → ISO 字串」  D05 §5「BigInt → 十進位字串」「數字與字串不互轉」  D06 §5「物件鍵遞迴排序,陣列保序」  D07 §5「不用 localeCompare」(鍵序同理)
//  D08 §5「其餘非 JSON 值拋錯,不靜默略過」  D10 §5 巢狀值(規格未定, 見規則帳本 R-BASELINE-01 規則3「依原則自行決定」)  D13/D14 §5「'h1:' + 16 進位」、「版本:同版凍結」
//  K01-K07 §3 寫入契約(缺 pk/fields、fields 含 orderKey、serverOnly 與 fields 交集)  P01-P03 §5「主鍵:依 schema 型別轉為字串;同批重複或缺漏 → baselineFormat」
//  P05-P06 §5「依 (order 數值, pk 碼元)…不用 localeCompare」  P08-P09 §5「依 scope 過濾」  F01-F04 §5「不識之格式或版本一律拒收 baselineFormat」
//  C01-C14 §6「compareBaseline…相符回 ok:true; 不符回 ok:false, reason, added, removed, changed, reordered」、§5「他人重排會被偵測, 系統重編號(名次不變)不會」(V9)、V2、V8、V10
//  S01-S03 §8「前後端 import 同一檔」、任務完成條件 2「同構: 零 import, 無 Node 全域之環境算出同一摘要」

let fpSrc = fileURLToPath(new URL('../src/baseline.mjs', import.meta.url))

//單欄契約, 以digest比較單一值之正規化
let F = { pk: 'id', fields: ['v'] }
let dg = (v) => digestRow({ id: 'x', v }, F)
let eq = (a, b, msg) => assert.strict.equal(dg(a), dg(b), msg)
let ne = (a, b, msg) => assert.notStrictEqual(dg(a), dg(b), msg)

//去除註解後之程式碼(區塊註解含JSDoc之/**與行註解), 供靜態檢查
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function getThrow(fn) {
    try {
        fn()
    }
    catch (e) {
        return e
    }
    assert.fail('預期拋錯但未拋')
}


describe('baseline 列摘要 digestRow(規格 §5)', function() {

    it('D01 欄位依契約宣告之序: 列內鍵序無關(正), 宣告序不同則摘要不同(反)', function() {
        let C1 = { pk: 'id', fields: ['a', 'b'] }
        let C2 = { pk: 'id', fields: ['b', 'a'] }
        assert.strict.equal(digestRow({ id: 'r', a: 1, b: 2 }, C1), digestRow({ b: 2, id: 'r', a: 1 }, C1))
        assert.notStrictEqual(digestRow({ id: 'r', a: 1, b: 2 }, C1), digestRow({ id: 'r', a: 1, b: 2 }, C2))
    })

    it('D02 只取fields: 未列欄位(含serverOnly與orderKey與系統欄位)變動不影響摘要(正), fields內欄位變動則不同(反)', function() {
        let C = { pk: 'id', fields: ['a'], serverOnly: ['s'], orderKey: 'order' }
        let base = { id: 'r', a: 1, s: 'old', order: 1, timeUpdate: 't1', userIdUpdate: 'u1', other: 'x' }
        let d0 = digestRow(base, C)
        assert.strict.equal(digestRow({ ...base, s: 'new', order: 9, timeUpdate: 't2', userIdUpdate: 'u2', other: 'y' }, C), d0)
        assert.notStrictEqual(digestRow({ ...base, a: 2 }, C), d0)
    })

    it('D03 undefined、null、空字串與缺欄為同一空值(正); 0、false、空白字串、空陣列、空物件不是空值(反)', function() {
        eq(undefined, null)
        eq(null, '')
        eq('', undefined)
        assert.strict.equal(digestRow({ id: 'x' }, F), dg(undefined), '缺欄同undefined')
        for (let v of [0, false, ' ', [], {}, 'null', '0']) {
            ne(v, null, `${JSON.stringify(v)}不等於空值`)
        }
    })

    it('D04 Date轉ISO字串: Date與其ISO字串同摘要(正), 不同時刻或不同字串不同(反), 無效Date拋錯', function() {
        let d = new Date('2026-10-22T08:09:10.123Z')
        eq(d, '2026-10-22T08:09:10.123Z')
        ne(d, new Date('2026-10-22T08:09:10.124Z'))
        ne(d, '2026-10-22T08:09:10Z')
        let e = getThrow(() => dg(new Date(NaN)))
        assert.ok(/invalid Date/.test(e.message))
    })

    it('D05 BigInt轉十進位字串: 5n與\'5\'同摘要(正), 5n與6n不同、數字5與字串\'5\'不同(數字與字串不互轉, 反)', function() {
        eq(5n, '5')
        eq(-12345678901234567890n, '-12345678901234567890')
        ne(5n, 6n)
        ne(5, '5')
        ne(5, 5n)
        ne(true, 'true')
    })

    it('D06 物件鍵遞迴排序, 陣列保序: 鍵序不同之物件同摘要(正), 陣列次序或值不同則不同(反)', function() {
        eq({ x: 1, y: { p: 1, q: [1, { b: 1, a: 2 }] } }, { y: { q: [1, { a: 2, b: 1 }], p: 1 }, x: 1 })
        ne([1, 2], [2, 1])
        ne({ x: 1, y: 2 }, { x: 2, y: 1 })
        ne({ a: { b: 1 } }, { a: { b: 2 } })
    })

    it('D07 鍵排序依UTF-16碼元序: 與localeCompare無關', function() {
        //'B'(66)排在'a'(97)之前, 不論區域; 兩物件鍵序相反者同摘要, 且序列化之文字順序固定(以凍結向量檢驗)
        eq({ a: 1, B: 2 }, { B: 2, a: 1 })
        eq({ '😀': 1, '～': 2 }, { '～': 2, '😀': 1 })
    })

    it('D08 其餘非JSON值拋錯不靜默: function、symbol、NaN、±Infinity、Map、Set、RegExp、類別實例、帶原型之物件(含巢狀)', function() {
        class P {
            constructor() {
                this.a = 1
            }
        }
        let bads = [
            () => 1, Symbol('s'), NaN, Infinity, -Infinity, new Map(), new Set(), /x/, new P(), Object.create({ inherited: 1 }),
            [1, () => 1], { k: NaN }, { k: { z: Infinity } }, [[Symbol('s')]], new Uint8Array(2), new Error('e'),
        ]
        for (let v of bads) {
            let e = getThrow(() => dg(v))
            assert.ok(/unsupported value of field\[v\]/.test(e.message), `${Object.prototype.toString.call(v)} → ${e.message}`)
        }
    })

    it('D08b 陣列之自有可列舉非索引屬性(如toJSON)拋錯: 其不入摘要卻會在JSON傳輸時改變內容而使兩端摘要不同(反); 空洞為null同JSON(正)', function() {
        let withToJson = [1]
        withToJson.toJSON = () => [2]
        let e = getThrow(() => dg(withToJson))
        assert.ok(/array with extra properties/.test(e.message))
        let withProp = [1, 2]
        withProp.x = 'extra'
        assert.throws(() => dg(withProp), /array with extra properties/)
        assert.throws(() => dg({ k: [withProp] }), /array with extra properties/, '巢狀亦然')
        //空洞同JSON傳輸為null
        // eslint-disable-next-line no-sparse-arrays
        eq([1, , 3], [1, null, 3])
        let arr = [1, 2, 3]
        arr.length = 5
        eq(arr, [1, 2, 3, null, null])
        //不可列舉之額外屬性不被JSON序列化, 不影響
        let hidden = [1]
        Object.defineProperty(hidden, 'meta', { value: 'x', enumerable: false })
        eq(hidden, [1])
    })

    it('D09 無原型物件與一般物件同視(正); 非物件之列拋錯(反)', function() {
        let o = Object.create(null)
        o.k = 1
        eq(o, { k: 1 })
        for (let row of [null, undefined, 'x', 5, [1], new Map(), new Set(), new Date(), /x/, () => 1, new Uint8Array(1)]) {
            assert.throws(() => digestRow(row, F), /invalid row: need an object/)
        }
        class P {
            constructor() {
                this.id = 'x'
                this.v = 1
            }
        }
        assert.strict.equal(digestRow(new P(), F), dg(1), '類別實例照常(只讀自有屬性)')
    })

    it('D10 巢狀值只依JSON語意: 物件鍵之值為undefined者略去, 陣列之undefined為null(正); 巢狀之null與空字串不等價、null與缺鍵不等價(反)', function() {
        eq({ a: undefined, b: 1 }, { b: 1 })
        eq([undefined], [null])
        ne({ a: null }, { a: '' })
        ne({ a: null }, {})
        ne([null], [])
        ne([null], [''])
    })

    it('D11 走訪上限: 深度超過100、循環參考、節點超過10萬者拋錯(反); 深度50照常(正)', function() {
        let deep = []
        for (let i = 0; i < 200; i++) {
            deep = [deep]
        }
        assert.throws(() => dg(deep), /too deep or circular/)
        let cyc = { k: 1 }
        cyc.self = cyc
        assert.throws(() => dg(cyc), /too deep or circular/)
        assert.throws(() => dg(new Array(100001).fill(1)), /too many nodes/)
        //節點上限為單列(各欄共用), 非單欄
        let C2 = { pk: 'id', fields: ['a', 'b'] }
        assert.throws(() => digestRow({ id: 'x', a: new Array(60000).fill(1), b: new Array(60000).fill(1) }, C2), /too many nodes/)
        assert.ok(/^h1:/.test(digestRow({ id: 'x', a: new Array(40000).fill(1), b: new Array(40000).fill(1) }, C2)))
        let ok = []
        for (let i = 0; i < 50; i++) {
            ok = [ok]
        }
        assert.ok(/^h1:/.test(dg(ok)))
    })

    it('D12 只讀自有屬性: 原型上之同名欄位視為缺欄(正), 自有屬性則採用(反)', function() {
        let proto = { v: 'inherited' }
        let row = Object.create(proto)
        row.id = 'x'
        assert.strict.equal(digestRow(row, F), dg(undefined))
        row.v = 'own'
        assert.strict.equal(digestRow(row, F), dg('own'))
    })

    it('D13 摘要格式與版本: h1前綴加14位小寫16進位; 凍結向量(演算法改動即失敗, 須改開h2而非改此值)', function() {
        let C = { pk: 'id', fields: ['a', 'b', 'c'] }
        assert.strict.equal(BASELINE_VERSION, 'h1')
        assert.strict.equal(digestRow({ id: 'r1', a: 1, b: 'x', c: null }, C), 'h1:1782ae62ff0643')
        assert.strict.equal(digestRow({ id: 'r1' }, C), 'h1:046d255e812572')
        assert.strict.equal(digestRow({ id: 'r1', a: new Date('2026-10-22T00:00:00Z'), b: { y: 2, x: [1, 2] }, c: 5n }, C), 'h1:0b041d267aae0e')
        //鍵序: 混合大小寫、非BMP與BMP之碼元序反例、整數樣鍵('10'與'9'), 序列化依UTF-16碼元序(localeCompare或原生整數鍵序皆會得到不同摘要)
        assert.strict.equal(dg({ 'a': 1, 'B': 2, '😀': 1, '～': 2, '10': 3, '9': 4 }), 'h1:044b949aca9950')
        assert.strict.equal(dg([5, '5', 5.5, true, null, 'a"b\\c\n', { k: [] }]), 'h1:091017815a9a45')
        for (let v of [1, 'a', null, { z: 1 }, 'x'.repeat(1000)]) {
            assert.ok(/^h1:[0-9a-f]{14}$/.test(dg(v)))
        }
    })

    it('D14 cyrb53: 與公開向量一致且為0至2^53-1之整數', function() {
        assert.strict.equal(cyrb53(''), 3338908027751811)
        assert.strict.equal(cyrb53('a'), 7929297801672961)
        assert.strict.equal(cyrb53('b'), 8684336938537663)
        assert.notStrictEqual(cyrb53('a', 1), cyrb53('a'))
        for (let s of ['', 'a', '中文😀', 'x'.repeat(5000)]) {
            let n = cyrb53(s)
            assert.ok(Number.isInteger(n) && n >= 0 && n < 2 ** 53)
        }
    })

    it('D15 -0與0同摘要(JSON語意, 凍結); 1e21與其數值同字串化', function() {
        eq(-0, 0)
        ne(1e21, 1e20)
    })

})


describe('baseline 契約驗證 checkContract(規格 §3)', function() {

    let ok = { table: 't', pk: 'id', fields: ['a', 'b'], serverOnly: ['s'], orderKey: 'order', scope: () => true }

    it('K01 合法契約通過(正): 最小形、完整形、serverOnly/orderKey/scope/table為null或未給', function() {
        assert.strict.equal(checkContract({ pk: 'id', fields: ['a'] }), true)
        assert.strict.equal(checkContract(ok), true)
        assert.strict.equal(checkContract({ pk: 'id', fields: ['a'], serverOnly: null, orderKey: null, scope: null, table: null }), true)
        assert.strict.equal(checkContract({ pk: 'id', fields: ['id', 'a'] }), true, 'pk可同在fields')
    })

    it('K02 缺pk或pk非非空字串者拋錯(反)', function() {
        for (let pk of [undefined, null, '', 5, ['id']]) {
            assert.throws(() => checkContract({ ...ok, pk }), /pk needs a non-empty string/)
        }
        let c = { ...ok }
        delete c.pk
        assert.throws(() => checkContract(c), /pk needs a non-empty string/)
    })

    it('K03 缺fields、非陣列、空陣列、含非字串或空字串或重複者拋錯(反)', function() {
        for (let fields of [undefined, null, 'a', {}, [], [1], [''], ['a', 'a'], [null]]) {
            assert.throws(() => checkContract({ ...ok, fields }), /invalid contract: fields/)
        }
    })

    it('K04 fields含orderKey者拋錯(反); orderKey等於pk者拋錯(反)', function() {
        assert.throws(() => checkContract({ ...ok, fields: ['a', 'order'] }), /fields must not contain orderKey/)
        assert.throws(() => checkContract({ ...ok, orderKey: 'id' }), /orderKey must not be pk/)
        assert.throws(() => checkContract({ ...ok, orderKey: '' }), /orderKey needs a non-empty string/)
        assert.throws(() => checkContract({ ...ok, orderKey: 5 }), /orderKey needs a non-empty string/)
    })

    it('K05 serverOnly與fields有交集者拋錯(反); serverOnly非陣列或含重複者拋錯(反)', function() {
        assert.throws(() => checkContract({ ...ok, serverOnly: ['b'] }), /serverOnly and fields must not overlap/)
        assert.throws(() => checkContract({ ...ok, serverOnly: 's' }), /invalid contract: serverOnly/)
        assert.throws(() => checkContract({ ...ok, serverOnly: ['s', 's'] }), /invalid contract: serverOnly/)
        assert.strict.equal(checkContract({ ...ok, serverOnly: [] }), true)
    })

    it('K06 scope非函數、table非字串、未知鍵、契約非純物件者拋錯(反)', function() {
        assert.throws(() => checkContract({ ...ok, scope: 'x' }), /scope needs a function/)
        assert.throws(() => checkContract({ ...ok, table: 5 }), /table needs a non-empty string/)
        assert.throws(() => checkContract({ ...ok, orderkey: 'order' }), /unsupported key/, '拼錯之鍵不得靜默忽略')
        //不可列舉之鍵與Symbol鍵亦為未知鍵(Object.keys只列可列舉之字串鍵, 會漏掉)
        let hiddenKey = { ...ok }
        Object.defineProperty(hiddenKey, 'orderkey', { value: 'order', enumerable: false })
        assert.throws(() => checkContract(hiddenKey), /unsupported key/)
        assert.throws(() => checkContract({ ...ok, [Symbol('x')]: 1 }), /unsupported key/)
        for (let c of [undefined, null, 'x', 5, [], () => 1, new Map()]) {
            assert.throws(() => checkContract(c), /invalid contract: need an object/)
        }
    })

    it('K07 digestRow、buildBaseline、compareBaseline皆先驗證契約(反)', function() {
        let bad = { pk: 'id' }
        assert.throws(() => digestRow({ id: 'a' }, bad), /invalid contract/)
        assert.throws(() => buildBaseline([], bad), /invalid contract/)
        assert.throws(() => compareBaseline([], [], bad), /invalid contract/)
        assert.throws(() => compareBaseline([], [], undefined), /invalid contract/)
    })

})


describe('baseline 主鍵與建立基準 buildBaseline(規格 §5)', function() {

    let C = { pk: 'id', fields: ['n'] }
    let ids = (bl) => bl.map((v) => v[0])

    it('P01 主鍵轉字串: 有限數字與BigInt轉十進位字串(正), 數字5與字串\'5\'同批視為重複(反)', function() {
        assert.deepStrictEqual(ids(buildBaseline([{ id: 5, n: 1 }, { id: 7n, n: 1 }, { id: 'x', n: 1 }], C)), ['5', '7', 'x'])
        let e = getThrow(() => buildBaseline([{ id: 5 }, { id: '5' }], C))
        assert.strict.equal(e.key, BASELINE_REJECT.format)
        assert.ok(/duplicate primary key/.test(e.message))
    })

    it('P02 主鍵缺漏者拋baselineFormat: undefined、null、空字串、布林、物件、NaN、Infinity、無此欄', function() {
        for (let id of [undefined, null, '', true, {}, [], NaN, Infinity]) {
            let e = getThrow(() => buildBaseline([{ id, n: 1 }], C))
            assert.strict.equal(e.key, BASELINE_REJECT.format)
            assert.ok(/no valid primary key/.test(e.message))
        }
        let e = getThrow(() => buildBaseline([{ n: 1 }], C))
        assert.strict.equal(e.key, BASELINE_REJECT.format)
    })

    it('P03 同批重複主鍵拋baselineFormat(反); 不同主鍵照常(正); 訊息不回顯主鍵值', function() {
        let e = getThrow(() => buildBaseline([{ id: 'secret-a' }, { id: 'b' }, { id: 'secret-a' }], C))
        assert.strict.equal(e.key, BASELINE_REJECT.format)
        assert.ok(!/secret-a/.test(e.message))
        assert.ok(/rows\[2\]/.test(e.message))
        assert.strict.equal(buildBaseline([{ id: 'a' }, { id: 'b' }], C).length, 2)
    })

    it('P04 列非物件或rows非陣列者拋錯(反)', function() {
        assert.throws(() => buildBaseline('x', C), /invalid rows: need an array/)
        assert.throws(() => buildBaseline(null, C), /invalid rows: need an array/)
        for (let row of [null, undefined, 'x', 5, [1]]) {
            assert.throws(() => buildBaseline([{ id: 'a' }, row], C), /invalid row: rows\[1\] needs an object/)
        }
        assert.deepStrictEqual(buildBaseline([], C), [])
    })

    it('P05 無orderKey依主鍵碼元序: 大寫在小寫之前、\'10\'在\'9\'之前、碼元序非碼點序(正); 與localeCompare序不同(反)', function() {
        let rows = ['b', 'a', 'B', '9', '10', '～', '😀'].map((id) => ({ id, n: 1 }))
        let got = ids(buildBaseline(rows, C))
        assert.deepStrictEqual(got, ['10', '9', 'B', 'a', 'b', '😀', '～'])
        let loc = [...got].sort((a, b) => a.localeCompare(b))
        assert.notDeepStrictEqual(got, loc, '若改用localeCompare, 結果會不同')
    })

    it('P06 有orderKey依(order數值, 主鍵碼元序): 數字字串依數值、同order依主鍵、缺漏或無法轉數字者排最後(正); 不依主鍵序(反)', function() {
        let CO = { pk: 'id', fields: ['n'], orderKey: 'order' }
        let rows = [
            { id: 'a', order: '10' },
            { id: 'b', order: 9 },
            { id: 'c', order: 9 },
            { id: 'd' },
            { id: 'e', order: 'x' },
            { id: 'f', order: null },
            { id: 'g', order: ' ' },
            { id: 'h', order: 2n },
            { id: 'i', order: NaN },
            { id: 'j', order: -1 },
        ]
        assert.deepStrictEqual(ids(buildBaseline(rows, CO)), ['j', 'h', 'b', 'c', 'a', 'd', 'e', 'f', 'g', 'i'])
    })

    it('P06b 名次之排序值為精確比較: 超過2^53之BigInt與整數字串不轉Number, 相鄰值不被視為同值而使重排漏判(反); 與Number混比亦精確', function() {
        let CO = { pk: 'id', fields: ['n'], orderKey: 'order' }
        //BigInt: 9007199254740992n 與 9007199254740993n 轉Number後相同
        let rows = [{ id: 'a', order: 9007199254740993n }, { id: 'b', order: 9007199254740992n }]
        assert.deepStrictEqual(ids(buildBaseline(rows, CO)), ['b', 'a'])
        let bl = buildBaseline(rows, CO)
        let swapped = [{ id: 'a', order: 9007199254740992n }, { id: 'b', order: 9007199254740993n }]
        let r = compareBaseline(swapped, bl, CO)
        assert.strict.equal(r.ok, false)
        assert.strict.equal(r.reordered, true, '交換兩個超過2^53之order須被偵測為重排')
        //整數字串(例如pg之BIGINT以字串回傳)
        let rowsS = [{ id: 'a', order: '9007199254740993' }, { id: 'b', order: '9007199254740992' }]
        assert.deepStrictEqual(ids(buildBaseline(rowsS, CO)), ['b', 'a'])
        //字串、BigInt、Number混用依數值: '10' > 9 > 8n; 帶符號與前導零
        let mixed = [{ id: 'a', order: '10' }, { id: 'b', order: 9 }, { id: 'c', order: 8n }, { id: 'd', order: '+007' }, { id: 'e', order: '-1' }, { id: 'f', order: 2.5 }]
        assert.deepStrictEqual(ids(buildBaseline(mixed, CO)), ['e', 'f', 'd', 'c', 'b', 'a'])
        //Number與BigInt之精確比較(9007199254740993n大於Number 9007199254740992)
        let nb = [{ id: 'a', order: 9007199254740993n }, { id: 'b', order: 9007199254740992 }]
        assert.deepStrictEqual(ids(buildBaseline(nb, CO)), ['b', 'a'])
        //缺漏仍排最後, 且在BigInt之後
        assert.deepStrictEqual(ids(buildBaseline([{ id: 'x' }, { id: 'y', order: 9007199254740993n }], CO)), ['y', 'x'])
    })

    it('P07 逐列基準只含該列; 輸出為[id, digest]之陣列且digest符合格式', function() {
        let bl = buildBaseline([{ id: 'only', n: 1 }], C)
        assert.strict.equal(bl.length, 1)
        assert.strict.equal(bl[0][0], 'only')
        assert.ok(/^h1:[0-9a-f]{14}$/.test(bl[0][1]))
        assert.strict.equal(bl[0][1], digestRow({ id: 'only', n: 1 }, C))
    })

    it('P08 scope: 只留scope回傳真值之列(正); 無scope時全留(反); scope收到列物件', function() {
        let rows = [{ id: 'a', n: 1, isApp: 'y' }, { id: 'b', n: 1, isApp: 'n' }, { id: 'c', n: 1 }]
        let seen = []
        let CS = {
            pk: 'id',
            fields: ['n'],
            scope: (r) => {
                seen.push(r.id); return r.isApp === 'y'
            }
        }
        assert.deepStrictEqual(ids(buildBaseline(rows, CS)), ['a'])
        assert.deepStrictEqual(seen, ['a', 'b', 'c'])
        assert.deepStrictEqual(ids(buildBaseline(rows, C)), ['a', 'b', 'c'])
    })

    it('P09 scope外之列不檢查主鍵(範圍外可有缺漏), 範圍內缺漏則拋錯', function() {
        let CS = { pk: 'id', fields: ['n'], scope: (r) => r.isApp === 'y' }
        assert.deepStrictEqual(ids(buildBaseline([{ isApp: 'n' }, { id: 'a', isApp: 'y' }], CS)), ['a'])
        assert.throws(() => buildBaseline([{ isApp: 'y' }], CS), /no valid primary key/)
    })

})


describe('baseline 格式與版本 isBaselineValid(規格 §5 版本)', function() {

    let good = 'h1:0123456789abcd'

    it('F01 合法基準(正): 空陣列、多列', function() {
        assert.strict.equal(isBaselineValid([]), true)
        assert.strict.equal(isBaselineValid([['a', good], ['b', good]]), true)
    })

    it('F02 非陣列、項非[字串,字串]、長度不為2、id為空字串者不合法(反)', function() {
        for (let b of [undefined, null, 'x', 5, {}, [null], ['a'], [['a']], [['a', good, 'x']], [['', good]], [[1, good]], [['a', 1]], [['a', null]], [[null, good]], [{ 0: 'a', 1: good, length: 2 }]]) {
            assert.strict.equal(isBaselineValid(b), false, JSON.stringify(b))
        }
        //稀疏陣列之空洞
        let sp = new Array(2)
        sp[1] = ['a', good]
        assert.strict.equal(isBaselineValid(sp), false)
    })

    it('F03 不識之版本與摘要格式不合法(反): h2、無前綴、長度不符、大寫、非16進位、舊套內格式', function() {
        for (let d of ['h2:0123456789abcd', '0123456789abcd', 'h1:0123456789abc', 'h1:0123456789abcde', 'h1:0123456789ABCD', 'h1:0123456789abcg', 'H1:0123456789abcd', 'h1:', '', 'm5zq9x1k']) {
            assert.strict.equal(isBaselineValid([['a', d]]), false, d)
        }
    })

    it('F04 同id出現兩次不合法(反), 即使摘要相同', function() {
        assert.strict.equal(isBaselineValid([['a', good], ['a', good]]), false)
        assert.strict.equal(isBaselineValid([['a', good], ['b', good]]), true)
    })

})


describe('baseline 比對 compareBaseline(規格 §6)', function() {

    let C = { pk: 'id', fields: ['name', 'tags'], orderKey: 'order' }
    let rows0 = () => [
        { id: 'a', name: 'A', tags: ['x'], order: 1, timeUpdate: 't1' },
        { id: 'b', name: 'B', tags: [], order: 2, timeUpdate: 't1' },
        { id: 'c', name: 'C', tags: null, order: 3, timeUpdate: 't1' },
    ]
    let bl0 = () => buildBaseline(rows0(), C)

    it('C01 相符回{ ok: true }(只有此鍵): 同內容、系統欄位與serverOnly變動、order重編號(名次不變)皆相符', function() {
        assert.deepStrictEqual(compareBaseline(rows0(), bl0(), C), { ok: true })
        let rows = rows0().map((r) => ({ ...r, timeUpdate: 't2', userIdUpdate: 'u9', order: r.order * 10 }))
        assert.deepStrictEqual(compareBaseline(rows, bl0(), C), { ok: true }, '重編號不被偵測')
        assert.deepStrictEqual(compareBaseline([...rows0()].reverse(), bl0(), C), { ok: true }, '讀取次序無關')
    })

    it('C02 內容改變: changed列出該id, reason為baselineMismatch(反)', function() {
        let rows = rows0()
        rows[1].name = 'B2'
        let r = compareBaseline(rows, bl0(), C)
        assert.deepStrictEqual(r, { ok: false, reason: 'baselineMismatch', added: [], removed: [], changed: ['b'], reordered: false })
    })

    it('C03 新增與刪除: added與removed各列出id(反)', function() {
        let rows = rows0().filter((r) => r.id !== 'a')
        rows.push({ id: 'd', name: 'D', tags: [], order: 4 })
        let r = compareBaseline(rows, bl0(), C)
        assert.deepStrictEqual(r, { ok: false, reason: 'baselineMismatch', added: ['d'], removed: ['a'], changed: [], reordered: false })
    })

    it('C04 他人重排(名次改變)被偵測: reordered為true, changed為空(反); 無orderKey之表依主鍵排序, 同樣之order變動不算(正)', function() {
        let rows = rows0()
        rows[0].order = 2
        rows[1].order = 1
        let r = compareBaseline(rows, bl0(), C)
        assert.strict.equal(r.ok, false)
        assert.strict.equal(r.reason, 'baselineMismatch')
        assert.strict.equal(r.reordered, true)
        assert.deepStrictEqual(r.changed, [])
        let C2 = { pk: 'id', fields: ['name', 'tags'] }
        assert.deepStrictEqual(compareBaseline(rows, buildBaseline(rows0(), C2), C2), { ok: true })
    })

    it('C05 系統重編號(名次不變)不被偵測(正): order值全換但相對次序同; 次序相同之跳號亦同', function() {
        let rows = rows0()
        rows[0].order = 100
        rows[1].order = 200
        rows[2].order = 300
        assert.deepStrictEqual(compareBaseline(rows, bl0(), C), { ok: true })
        rows[2].order = 250
        assert.deepStrictEqual(compareBaseline(rows, bl0(), C), { ok: true })
        rows[2].order = 150
        assert.strict.equal(compareBaseline(rows, bl0(), C).reordered, true, '落在a與b之間則名次改變(反)')
    })

    it('C06 名次變動附帶增刪: 移動一列至最後仍為reordered(反)', function() {
        let rows = rows0()
        rows[0].order = 99
        let r = compareBaseline(rows, bl0(), C)
        assert.strict.equal(r.reordered, true)
        assert.strict.equal(r.ok, false)

        //重排同時有增刪: 基準 a,b,c; 目前 b,a,d(c 被刪、d 新增、a 與 b 對調) → added[d]、removed[c]、reordered true、changed 空
        let now = [
            { id: 'b', name: 'B', tags: [], order: 1 },
            { id: 'a', name: 'A', tags: ['x'], order: 2 },
            { id: 'd', name: 'D', tags: [], order: 3 },
        ]
        assert.deepStrictEqual(compareBaseline(now, bl0(), C), { ok: false, reason: 'baselineMismatch', added: ['d'], removed: ['c'], changed: [], reordered: true })
        //增刪但共有之列次序不變 → reordered 為 false(增刪不算重排)
        let now2 = [
            { id: 'a', name: 'A', tags: ['x'], order: 1 },
            { id: 'd', name: 'D', tags: [], order: 2 },
            { id: 'b', name: 'B', tags: [], order: 3 },
        ]
        assert.deepStrictEqual(compareBaseline(now2, bl0(), C), { ok: false, reason: 'baselineMismatch', added: ['d'], removed: ['c'], changed: [], reordered: false })
    })

    it('C07 單列基準且該列已不在、無新增列: reason為rowNotFound(反); 另有新增列或多列基準則為baselineMismatch', function() {
        let bl = buildBaseline([rows0()[0]], C)
        let r = compareBaseline([], bl, C)
        assert.deepStrictEqual(r, { ok: false, reason: 'rowNotFound', added: [], removed: ['a'], changed: [], reordered: false })
        let r2 = compareBaseline([{ id: 'z', name: 'Z' }], bl, C)
        assert.strict.equal(r2.reason, 'baselineMismatch')
        let r3 = compareBaseline([], bl0(), C)
        assert.strict.equal(r3.reason, 'baselineMismatch')
        assert.deepStrictEqual(compareBaseline([rows0()[0]], bl, C), { ok: true }, '該列仍在且未變則相符(正)')
        let rows = rows0().slice(0, 1)
        rows[0].name = 'changed'
        assert.strict.equal(compareBaseline(rows, bl, C).reason, 'baselineMismatch', '該列在但已改: 非rowNotFound')
    })

    it('C08 baselineFormat(反): 非陣列、null、undefined、項格式錯、不識之版本、重複id; 不比對且各差異欄為空', function() {
        let none = { ok: false, reason: 'baselineFormat', added: [], removed: [], changed: [], reordered: false }
        for (let b of [undefined, null, 'x', {}, [['a']], [['a', 'h2:0123456789abcd']], [['a', 'h1:0123456789abcd'], ['a', 'h1:0123456789abcd']], [['', 'h1:0123456789abcd']]]) {
            assert.deepStrictEqual(compareBaseline(rows0(), b, C), none, JSON.stringify(b))
        }
    })

    it('C09 空表: 空基準對空列相符(正), 對有列者為added(反); 有基準而列為空者為removed', function() {
        assert.deepStrictEqual(compareBaseline([], [], C), { ok: true })
        let r = compareBaseline(rows0(), [], C)
        assert.deepStrictEqual(r.added, ['a', 'b', 'c'])
        assert.strict.equal(r.reason, 'baselineMismatch')
        let r2 = compareBaseline([], bl0(), C)
        assert.deepStrictEqual(r2.removed, ['a', 'b', 'c'])
    })

    it('C10 庫內列之主鍵缺漏或重複拋key為rowsInvalid之Error(庫內資料異常, 非客戶端之基準格式錯誤, 不得與baselineFormat混為一類), 非回傳值', function() {
        let e = getThrow(() => compareBaseline([{ id: 'a' }, { id: 'a' }], bl0(), C))
        assert.strict.equal(e.key, 'rowsInvalid')
        assert.notStrictEqual(e.key, BASELINE_REJECT.format)
        assert.ok(/invalid rowsNow/.test(e.message))
        let e2 = getThrow(() => compareBaseline([{ name: 'x' }], bl0(), C))
        assert.strict.equal(e2.key, 'rowsInvalid')
        //buildBaseline本身(如前端對畫面所見之列自算)仍為baselineFormat
        assert.strict.equal(getThrow(() => buildBaseline([{ id: 'a' }, { id: 'a' }], C)).key, BASELINE_REJECT.format)
        //客戶端基準之格式錯誤優先回傳baselineFormat(不讀rowsNow), 即使rowsNow異常
        assert.strict.equal(compareBaseline([{ id: 'a' }, { id: 'a' }], [['a']], C).reason, 'baselineFormat')
    })

    it('C11 scope(V8): 範圍外新增之列不影響(正), 範圍內新增為added(反); 列移出範圍為removed, 移入為added', function() {
        let CS = { pk: 'id', fields: ['name'], scope: (r) => r.isApp === 'y' }
        let base = [{ id: 'a', name: 'A', isApp: 'y' }, { id: 's1', name: 'S', isApp: 'n' }]
        let bl = buildBaseline(base, CS)
        assert.deepStrictEqual(bl.map((v) => v[0]), ['a'])
        assert.deepStrictEqual(compareBaseline([...base, { id: 's2', name: 'S2', isApp: 'n' }], bl, CS), { ok: true })
        assert.deepStrictEqual(compareBaseline([{ id: 'a', name: 'A', isApp: 'y' }, { id: 's1', name: 'S', isApp: 'n' }, { id: 'n', name: 'N', isApp: 'y' }], bl, CS).added, ['n'])
        assert.deepStrictEqual(compareBaseline([{ id: 'a', name: 'A', isApp: 'n' }], bl, CS).removed, ['a'])
        assert.deepStrictEqual(compareBaseline([{ id: 'a', name: 'A', isApp: 'y' }, { id: 's1', name: 'S', isApp: 'y' }], bl, CS).added, ['s1'])
    })

    it('C12 傳輸等價(V10之純函數部分): 伺服端列(Date、BigInt、number id、undefined欄)與經JSON傳輸之列算出同一基準(正); 型別真的不同(number對string)則不同(反)', function() {
        let CT = { pk: 'id', fields: ['when', 'big', 'obj', 'gone'], orderKey: 'order' }
        let server = [
            { id: 1, order: 1, when: new Date('2026-10-22T01:02:03.004Z'), big: 12n, obj: { b: 1, a: { d: undefined, c: [1, undefined] } }, gone: undefined },
            { id: 2, order: 2, when: null, big: undefined, obj: { z: null }, gone: '' },
        ]
        let wire = JSON.parse(JSON.stringify(server, (k, v) => (typeof v === 'bigint' ? v.toString() : v)))
        assert.deepStrictEqual(buildBaseline(wire, CT), buildBaseline(server, CT))
        assert.deepStrictEqual(compareBaseline(server, buildBaseline(wire, CT), CT), { ok: true })
        let wire2 = JSON.parse(JSON.stringify(wire))
        wire2[0].big = 12
        assert.notDeepStrictEqual(buildBaseline(wire2, CT), buildBaseline(server, CT))
    })

    it('C13 compareBaseline不改動輸入(rowsNow、baseline、contract)', function() {
        let rows = rows0()
        let bl = bl0()
        let snapRows = JSON.stringify(rows)
        let snapBl = JSON.stringify(bl)
        let C3 = { ...C }
        compareBaseline(rows, bl, C3)
        compareBaseline([], bl, C3)
        assert.strict.equal(JSON.stringify(rows), snapRows)
        assert.strict.equal(JSON.stringify(bl), snapBl)
        assert.deepStrictEqual(C3, C)
    })

    it('C14 大表: 5000列之基準與比對一致且逐列變動可被找出', function() {
        let rows = []
        for (let i = 0; i < 5000; i++) {
            rows.push({ id: `id-${i}`, name: `n${i}`, tags: [i], order: i })
        }
        let bl = buildBaseline(rows, C)
        assert.strict.equal(bl.length, 5000)
        assert.deepStrictEqual(compareBaseline(rows, bl, C), { ok: true })
        rows[4321].tags = [-1]
        assert.deepStrictEqual(compareBaseline(rows, bl, C).changed, ['id-4321'])
    })

})


describe('baseline 輔助: pickWriteRow(存檔白名單, V5)與getRejectKey', function() {

    let C = { pk: 'id', fields: ['name', 'blocked'], serverOnly: ['pw'], orderKey: 'order' }

    it('H01 pickWriteRow只留pk與fields: 伺服器專有欄位(舊值)、系統欄位、orderKey、未知欄位皆不輸出(V5: 客戶端持舊列整列送出時不回寫舊值)', function() {
        let stale = { id: 'u1', name: 'A2', blocked: 'n', pw: 'OLD', order: 3, timeUpdate: 't', userIdUpdate: 'u', other: 'x' }
        assert.deepStrictEqual(pickWriteRow(stale, C), { id: 'u1', name: 'A2', blocked: 'n' })
        //未給或undefined之欄位不輸出(save對未給之欄位保留庫內值), null與空字串照給(使用者清空之意圖)
        assert.deepStrictEqual(pickWriteRow({ id: 'u1', name: undefined, blocked: null }, C), { id: 'u1', blocked: null })
        assert.deepStrictEqual(pickWriteRow({ id: 'u1', name: '' }, C), { id: 'u1', name: '' })
        //只讀自有屬性
        let row = Object.create({ name: 'inherited' })
        row.id = 'u1'
        assert.deepStrictEqual(pickWriteRow(row, C), { id: 'u1' })
        //回傳新物件, 不改輸入
        let src = { id: 'u1', name: 'A' }
        let out = pickWriteRow(src, C)
        assert.notStrictEqual(out, src)
        assert.deepStrictEqual(src, { id: 'u1', name: 'A' })
    })

    it('H02 pickWriteRow: pk同在fields內不重複輸出; 鍵為__proto__時為自有屬性而非改設原型; 契約或列無效者拋錯', function() {
        assert.deepStrictEqual(pickWriteRow({ id: 'u1', name: 'A' }, { pk: 'id', fields: ['id', 'name'] }), { id: 'u1', name: 'A' })
        let row = JSON.parse('{"id":"u1","__proto__":{"polluted":1},"name":"A"}')
        let out = pickWriteRow(row, { pk: 'id', fields: ['__proto__', 'name'] })
        assert.strict.equal(Object.getPrototypeOf(out), Object.prototype)
        assert.strict.equal(Object.prototype.hasOwnProperty.call(out, '__proto__'), true)
        assert.strict.equal(({}).polluted, undefined)
        assert.throws(() => pickWriteRow({ id: 'u1' }, { pk: 'id' }), /invalid contract/)
        for (let r of [null, undefined, 'x', [1], new Map()]) {
            assert.throws(() => pickWriteRow(r, C), /invalid row: need an object/)
        }
    })

    it('H03 getRejectKey: 字串原樣(procOrm之rowNotFound)、帶字串key之Error取其key(guardWrite)、其餘為null(一般例外)', function() {
        assert.strict.equal(getRejectKey('rowNotFound'), 'rowNotFound')
        assert.strict.equal(getRejectKey('failed to save data'), 'failed to save data')
        let e = new Error('baselineMismatch')
        e.key = 'baselineMismatch'
        assert.strict.equal(getRejectKey(e), 'baselineMismatch')
        assert.strict.equal(getRejectKey(new Error('plain')), null)
        let e2 = new Error('x')
        e2.key = 5
        assert.strict.equal(getRejectKey(e2), null)
        for (let v of [null, undefined, 5, {}, [], () => 1]) {
            assert.strict.equal(getRejectKey(v), null)
        }
    })

})


describe('baseline 同構與零依賴(規格 §8、V10)', function() {

    it('S01 靜態: 原始碼無import、require、動態import、Node專屬全域', function() {
        let src = fs.readFileSync(fpSrc, 'utf8')
        let code = stripComments(src)
        assert.ok(!/^\s*import\s/m.test(code), '不得有import敘述')
        assert.ok(!/\bimport\s*\(/.test(code), '不得有動態import')
        assert.ok(!/\brequire\s*\(/.test(code), '不得有require')
        for (let name of ['process', 'Buffer', '__dirname', '__filename', 'global', 'module', 'exports', 'setImmediate']) {
            assert.ok(!new RegExp(`(^|[^.\\w$])${name}\\b`).test(code), `不得使用Node專屬全域: ${name}`)
        }
        assert.strict.equal((code.match(/^export\s/gm) || []).length, 1, '末尾須為單一export敘述')
    })

    it('S02 靜態: 不用舊版打包器無法解析之語法(?.、??、**、BigInt字面值、class欄位、async迭代)', function() {
        let src = fs.readFileSync(fpSrc, 'utf8')
        let code = stripComments(src)
        assert.ok(!/\?\.[A-Za-z_$[(]/.test(code), '不得用?.')
        assert.ok(!/\?\?/.test(code), '不得用??')
        assert.ok(!/\*\*/.test(code), '不得用**')
        assert.ok(!/[^\w$.]\d+n\b/.test(code), '不得用BigInt字面值')
        assert.ok(!/for\s+await/.test(code))
    })

    it('S03 動態: 於只有標準全域之vm執行同一原始碼, 與Node直接import算出完全相同之摘要與基準與比對結果', function() {
        let src = fs.readFileSync(fpSrc, 'utf8')
        let m = src.match(/^export\s*\{([^}]*)\}\s*$/m)
        assert.ok(m, '找不到單一export敘述')
        let code = src.replace(m[0], `globalThis.__B = { ${m[1]} }`)
        let ctx = vm.createContext({})
        vm.runInContext(code, ctx)
        let B = ctx.__B

        //沙箱無Node全域
        assert.strict.equal(vm.runInContext('typeof process + typeof require + typeof Buffer + typeof module + typeof global', ctx), 'undefinedundefinedundefinedundefinedundefined')
        assert.deepStrictEqual(Object.keys(B).sort(), Object.keys({ BASELINE_VERSION, BASELINE_REJECT, cyrb53, checkContract, digestRow, buildBaseline, isBaselineValid, compareBaseline, pickWriteRow, getRejectKey }).sort())

        //fixture原始碼, 分別於Node與vm內求值(物件、Date、BigInt、函數各自屬於該realm)
        let fixture = `({
            contract: { table: 't', pk: 'id', fields: ['when', 'big', 'obj', 'arr', 'text', 'n', 'flag', 'gone'], serverOnly: ['s'], orderKey: 'order', scope: (r) => r.isApp !== 'n' },
            rows: [
                { id: 'b', order: 2, when: new Date(Date.UTC(2026, 9, 22, 1, 2, 3, 4)), big: 12345678901234567890n, obj: { z: 1, a: { y: [1, { q: 2, p: undefined }], x: null } }, arr: [null, undefined, '', 0], text: '中文😀\\ud83d', n: -0, flag: false, gone: undefined, s: 'srv' },
                { id: 'a', order: 1, when: '2026-10-22T01:02:03.004Z', big: '1', obj: {}, arr: [], text: '', n: 1e21, flag: true, isApp: 'y' },
                { id: 7, order: '3', when: null, big: undefined, obj: null, arr: undefined, text: 'x'.repeat(3000), n: 0.1, flag: null, isApp: 'n' },
                { id: 'c', when: new Date(Date.UTC(1, 0, 1)), big: 0n, obj: { 'k': 'v' }, arr: [[]], text: 'a < b', n: 5, flag: true },
            ],
        })`
        let fxNode = vm.runInThisContext(fixture)
        let fxCtx = vm.runInContext(fixture, ctx)

        let toJson = (v) => JSON.stringify(v)
        let blNode = buildBaseline(fxNode.rows, fxNode.contract)
        assert.ok(blNode.length >= 3)

        //(1)各realm各用自己之物件
        assert.strict.equal(toJson(B.buildBaseline(fxCtx.rows, fxCtx.contract)), toJson(blNode))
        for (let k = 0; k < fxNode.rows.length; k++) {
            assert.strict.equal(B.digestRow(fxCtx.rows[k], fxCtx.contract), digestRow(fxNode.rows[k], fxNode.contract))
        }
        //(2)跨realm: vm內之函數處理Node之物件, Node之函數處理vm內之物件
        assert.strict.equal(toJson(B.buildBaseline(fxNode.rows, fxNode.contract)), toJson(blNode))
        assert.strict.equal(toJson(buildBaseline(fxCtx.rows, fxCtx.contract)), toJson(blNode))
        //(3)比對結果與格式驗證同構
        assert.deepStrictEqual(JSON.parse(toJson(B.compareBaseline(fxCtx.rows, blNode, fxCtx.contract))), { ok: true })
        assert.deepStrictEqual(JSON.parse(toJson(compareBaseline(fxCtx.rows, B.buildBaseline(fxCtx.rows, fxCtx.contract), fxNode.contract))), { ok: true })
        let rowsChanged = vm.runInContext(`(${fixture}).rows.map((r, i) => (i === 0 ? { ...r, n: 2 } : r))`, ctx)
        let rc = JSON.parse(toJson(B.compareBaseline(rowsChanged, blNode, fxCtx.contract)))
        assert.deepStrictEqual(rc.changed, ['b'])
        assert.strict.equal(B.isBaselineValid(blNode), true)
        assert.strict.equal(B.isBaselineValid([['a', 'h2:0123456789abcd']]), false)
        assert.strict.equal(B.cyrb53('中文😀'), cyrb53('中文😀'))
        //pickWriteRow之輸出含BigInt(JSON無法序列化), 以摘要比較; 且輸出之摘要同原列(只動白名單)
        assert.strict.equal(B.digestRow(B.pickWriteRow(fxCtx.rows[0], fxCtx.contract), fxCtx.contract), digestRow(pickWriteRow(fxNode.rows[0], fxNode.contract), fxNode.contract))
        assert.strict.equal(digestRow(pickWriteRow(fxNode.rows[0], fxNode.contract), fxNode.contract), digestRow(fxNode.rows[0], fxNode.contract))
        assert.strict.equal(B.getRejectKey('rowNotFound'), 'rowNotFound')
        //超過2^53之BigInt名次於vm內亦精確(不轉Number)
        let bigRows = vm.runInContext(`[{ id: 'a', order: 9007199254740993n }, { id: 'b', order: 9007199254740992n }]`, ctx)
        let CO = { pk: 'id', fields: ['n'], orderKey: 'order' }
        assert.strict.equal(toJson(B.buildBaseline(bigRows, CO)), toJson(buildBaseline([{ id: 'a', order: 9007199254740993n }, { id: 'b', order: 9007199254740992n }], CO)))
        assert.strict.equal(toJson(B.buildBaseline(bigRows, CO).map((v) => v[0])), '["b","a"]')

        //(4)凍結向量於vm內亦同
        assert.strict.equal(B.digestRow({ id: 'r1', a: 1, b: 'x', c: null }, { pk: 'id', fields: ['a', 'b', 'c'] }), 'h1:1782ae62ff0643')

        //(5)非JSON值於vm內亦拋錯(以Error物件判定, 不比較跨realm之建構子)
        let e = null
        try {
            B.digestRow({ id: 'x', v: new Map() }, { pk: 'id', fields: ['v'] })
        }
        catch (err) {
            e = err
        }
        assert.ok(e !== null && /unsupported value of field\[v\]/.test(e.message))
    })

})
