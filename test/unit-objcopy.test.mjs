import assert from 'assert'
import vm from 'vm'
import { createSecretKey } from 'crypto'
import util from 'util'
import WServOrm from '../src/WServOrm.mjs'
import getMapOrm from '../src/getMapOrm.mjs'
import { createStub, getReject, quiet, same, mkForgedObjProto as mkForged12 } from './tools/ormStub.mjs'


//R-OBJ-01 使用端物件之迭代與複製(L01-L04、P01-P03)、R-INPUT-01 規則3 之 select 與 delAll(D01-D03)
//替身ORM記錄ORM收到之實參(spy); 規格之來源: CLAUDE_rulebook.md 之 R-OBJ-01、R-INPUT-01, 及 dspec「w-orm系列條件語法支援盤點.md」一之一
let stub = createStub()
let { WOrmStub, calls } = stub

let dsStr = { tests: { keys: ['id', 'name', 'length'], settings: { id: { pk: true, type: 'STRING' }, name: { type: 'STRING' } } } }
let dsUnknown = { tests: { keys: ['id', 'name', 'length'] } }
let dsInt = { tests: { keys: ['id', 'name', 'length'], settings: { id: { pk: true, type: 'INTEGER' }, name: { type: 'STRING' } } } }
let isGen = (v) => typeof v === 'string' && v.length > 30
let wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let clone = (v) => structuredClone(v)

//kinds, 四種資料表型態: 字串型主鍵(轉型與補值)、型別未知(同)、整數型主鍵(皆不)、ds無該表(皆不; 直接呼叫getMapOrm令ds與woItems不一致)
function getKinds() {
    return [
        { kind: 'str', cast: true, proc: WServOrm(dsStr, WOrmStub, 'u', 'd').procOrm },
        { kind: 'unknown', cast: true, proc: WServOrm(dsUnknown, WOrmStub, 'u', 'd').procOrm },
        { kind: 'int', cast: false, proc: WServOrm(dsInt, WOrmStub, 'u', 'd').procOrm },
        { kind: 'none', cast: false, proc: getMapOrm({ others: dsStr.tests }, { tests: WOrmStub() }) },
    ]
}

//parse, JSON.parse 才能產生自有 __proto__ 鍵(物件字面量之 __proto__ 為設原型)
let parse = (c) => JSON.parse(c)


describe('R-OBJ-01 使用端物件之迭代與複製', function() {

    beforeEach(function() {
        stub.reset()
    })

    //find 語料: [送入之find, 轉型表(str、unknown)時ORM應收到者]; 轉型只改id之有限數字(R-ID-02), 其餘原樣
    let finds = [
        [{ length: 1, name: 'x' }],
        [{ length: 0 }],
        [{ length: 0, name: 'alpha' }],
        [{ id: 'a1', length: 3 }],
        [{ id: 5, length: 2 }, { id: '5', length: 2 }],
        [{ $and: [{ length: 1, name: 'x' }], $or: [{ length: 2 }, { id: 7, length: 1 }] }, { $and: [{ length: 1, name: 'x' }], $or: [{ length: 2 }, { id: '7', length: 1 }] }],
        [{ id: { length: 2, $in: [1, 2] } }, { id: { length: 2, $in: ['1', '2'] } }],
        [{ id: { length: 1, $eq: 9 } }, { id: { length: 1, $eq: '9' } }],
        [{ name: { length: 1, $regex: '^a' } }],
        //對照: 非陣列樣之length(非整數、負數、字串、null)修前修後皆原樣
        [{ length: 3.5, name: 'x' }],
        [{ length: -1, name: 'x' }],
        [{ length: '3', name: 'x' }],
        [{ length: null, name: 'x' }],
    ]

    it('L01 select與delAll之find含整數length鍵: ORM收到之實參與送入者相同(id之有限數字轉字串除外)', async function() {
        //R-OBJ-01 規則1: 修前 {length:1,name:'x'} 被當陣列樣迭代而成 {0:undefined}, 條件整個消失(select回全表、delAll刪全表)
        for (let { kind, cast, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let [k, [find, expectCast]] of finds.entries()) {
                    stub.reset()
                    await proc('u1', 'tests', mode, find)
                    assert.strictEqual(calls.length, 1, `${kind} ${mode} #${k}`)
                    assert.strictEqual(calls[0].fn, mode)
                    same(calls[0].data, cast && expectCast ? expectCast : find, `${kind} ${mode} #${k} ORM收到`)
                    if (!cast) {
                        //整數型主鍵與ds無該表者不複製, 原物件交ORM(故內容斷言恆真, 鑑別力來自str、unknown兩種; 此處明示不複製)
                        assert.strictEqual(calls[0].data, find, `${kind} ${mode} #${k} 應為同一參考`)
                    }
                }
            }
        }
    })

    it('L02 find之length為極大整數: 不依length迭代, 立即完成且ORM收到之實參不變', async function() {
        //R-OBJ-01 規則1: lodash each 之迭代次數即 length 之值(2e7次約61 ms, 2^53-1 實質不終止), 可由資料通道送入而癱瘓事件迴圈
        //先以 2e6 (修前亦可完成, 修前以內容不符轉紅而不至於不終止)再以 2^53-1
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                let f1 = { length: 2e6, name: 'x' }
                stub.reset()
                await proc('u1', 'tests', mode, f1)
                same(calls[0].data, { length: 2e6, name: 'x' }, `${kind} ${mode} length=2e6`)

                let f2 = { length: Number.MAX_SAFE_INTEGER, name: 'x' }
                stub.reset()
                let t = Date.now()
                await proc('u1', 'tests', mode, f2)
                assert.ok(Date.now() - t < 1000, `${kind} ${mode} length=2^53-1 耗時 ${Date.now() - t} ms`)
                same(calls[0].data, { length: Number.MAX_SAFE_INTEGER, name: 'x' }, `${kind} ${mode} length=2^53-1`)
            }
        }
    })

    //rows 語料: 含整數length欄之列、非整數length、無length、無主鍵
    let rows = [
        { id: 'l1', name: 'x', length: 3 },
        { id: 'l2', name: 'y', length: 'abc' },
        { id: 'l3', name: 'z' },
        { name: 'noid', length: 0 },
        { length: 2 },
        { id: 'l5', length: 2 }, //已帶主鍵、無其他欄位: 主鍵須原樣(外審 sol F5: 不得被錯改)
        { id: 'l6', length: Number.MAX_SAFE_INTEGER },
    ]

    //getSent, 取ORM收到之列; fn為寫入之函數名
    let runWrite = async (proc, how, input) => {
        stub.reset()
        let r
        if (how === 'insert' || how === 'save') {
            r = await proc('u1', 'tests', how, input)
            return { r, sent: calls[0].data }
        }
        r = await proc('u1', 'tests', 'mix', how === 'mix.add' ? { add: input } : { diff: input })
        return { r, sent: calls[0].data }
    }

    it('L03 寫入列含整數length欄: 原樣交ORM, 回傳主鍵與ORM收到者一致, 不補或只補缺的主鍵', async function() {
        //R-OBJ-01 規則1: 修前整列內容遺失(insert、mix回傳之主鍵被換成產生值; save單筆之列變{}而不寫入並回報{id:undefined})
        for (let { kind, cast, proc } of getKinds()) {
            if (kind === 'none') {
                continue //ds無該表時adjustData拋錯(既有行為), 與本規則無關
            }
            for (let how of ['insert', 'save', 'mix.add', 'mix.diff']) {
                let { r, sent } = await runWrite(proc, how, rows)
                assert.strictEqual(sent.length, rows.length, `${kind} ${how}`)
                rows.forEach((row, i) => {
                    let got = sent[i]
                    let { id: idGot, ...restGot } = got
                    let { id: idRow, ...restRow } = row
                    same(restGot, restRow, `${kind} ${how} 列${i}之其餘欄位`)
                    if (typeof idRow === 'string') {
                        assert.strictEqual(idGot, idRow, `${kind} ${how} 列${i}之主鍵`)
                    }
                    else if (cast) {
                        assert.ok(isGen(idGot), `${kind} ${how} 列${i}缺主鍵者補值: ${idGot}`)
                    }
                    else {
                        assert.strictEqual(idGot, undefined, `${kind} ${how} 列${i}整數型主鍵欄不補值`)
                    }
                })
                same(r, sent.map((v) => ({ id: v.id })), `${kind} ${how} 回傳主鍵`)
            }

            //單一物件(insert、save)
            for (let how of ['insert', 'save']) {
                let { r, sent } = await runWrite(proc, how, { id: 's1', name: 'x', length: 1 })
                same(sent, { id: 's1', name: 'x', length: 1 }, `${kind} ${how} 單一物件`)
                same(r, { id: 's1' }, `${kind} ${how} 單一物件回傳`)
                let r2 = await runWrite(proc, how, { length: 0 })
                if (cast) {
                    assert.ok(isGen(r2.sent.id) && r2.r.id === r2.sent.id, `${kind} ${how} 單一{length:0}補值`)
                    same({ ...r2.sent, id: 'G' }, { length: 0, id: 'G' }, `${kind} ${how} 單一{length:0}其餘欄位`)
                }
                else {
                    same(r2.sent, { length: 0 }, `${kind} ${how} 單一{length:0}`)
                }
            }
        }
    })

    it('L04 呼叫端之find與寫入列不被改動(ds無稽核欄位者)', async function() {
        //R-OBJ-01 規則2、R-ID-02 規則4: 複本寫於新物件
        //本案之ds不含稽核欄位(userId、timeCreate、userIdUpdate、timeUpdate): ds含稽核欄位時adjustData直接賦值於呼叫端傳入之列, 屬既有行為, 見規則帳本R-OBJ-01之已知限制
        for (let { kind, proc } of getKinds()) {
            for (let [find] of finds) {
                let copy = clone(find)
                await proc('u1', 'tests', 'select', find)
                await proc('u1', 'tests', 'delAll', find)
                same(find, copy, `${kind} find被改動`)
            }
            if (kind === 'none') {
                continue
            }
            for (let how of ['insert', 'save', 'mix.add', 'mix.diff']) {
                let input = clone(rows)
                await runWrite(proc, how, input)
                same(input, rows, `${kind} ${how} 寫入列被改動`)
            }
        }
    })

    it('L05 授權函數(addFunCheck)所見之find, 即ORM收到之find(無id數字轉型者)', async function() {
        //R-OBJ-01 依據: S5「授權所見即執行所用」在ORM邊界須成立
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        let seen = []
        so.addFunCheck(({ input }) => {
            seen.push(clone(input))
        })
        await wait(20)
        let list = finds.filter(([, expectCast]) => expectCast === undefined).map(([f]) => f)
        for (let f of list) {
            await so.procOrm('u1', 'tests', 'select', f)
            await so.procOrm('u1', 'tests', 'delAll', f)
        }
        assert.strictEqual(seen.length, calls.length)
        calls.forEach((c, i) => {
            same(c.data, seen[i], `第${i}次ORM收到者與授權函數所見`)
        })
    })

    it('L06 del與mix之del列含整數length鍵: 不依length迭代, 照常交ORM(數字主鍵轉字串, 其餘原樣)', async function() {
        //R-OBJ-01 規則1、已知限制(del各筆不做__proto__檢查): castIdRows以展開複製, 不依length迭代(行為鎖定, 修前亦綠)
        for (let { kind, cast, proc } of getKinds()) {
            if (kind === 'none') {
                continue
            }
            stub.reset()
            await proc('u1', 'tests', 'del', [{ id: 5, length: 3 }, { id: 'a', length: 2 }])
            await proc('u1', 'tests', 'del', { id: 7, length: 0 })
            await proc('u1', 'tests', 'mix', { del: [{ id: 8, length: 1 }] })
            same(calls.map((c) => c.data), cast
                ? [[{ id: '5', length: 3 }, { id: 'a', length: 2 }], { id: '7', length: 0 }, [{ id: '8', length: 1 }]]
                : [[{ id: 5, length: 3 }, { id: 'a', length: 2 }], { id: 7, length: 0 }, [{ id: 8, length: 1 }]], kind)
        }
    })

})


describe('R-OBJ-01 規則3 自有__proto__鍵 fail-closed', function() {

    beforeEach(function() {
        stub.reset()
    })

    let msgFind = (mode) => `invalid find of ${mode}, unsupported key[__proto__]`

    it('P01 find任何位置含自有__proto__鍵即reject, ORM未被呼叫, 訊息不回顯客戶端之值', async function() {
        //R-OBJ-01 規則3: 頂層、$and/$or/$nor、id之條件物件及其$not、他欄之值、陣列內之物件、深層
        //檢查與運算子名稱無關(任何鍵之任何深度): 系列白名單外之$nor、$not雖由後端reject, 本檢查仍須先擋下含自有__proto__鍵者(R-WL-01 規則2)
        let finds = [
            '{"__proto__":{"x":1}}',
            '{"__proto__":"SECRET-VALUE"}',
            '{"id":"a1","__proto__":{"id":"zzz"}}',
            '{"id":5,"__proto__":1}',
            '{"$and":[{"__proto__":{"x":1}}]}',
            '{"$or":[{"name":"a"},{"$and":[{"__proto__":1}]}]}',
            '{"$nor":[{"__proto__":{}}]}',
            '{"id":{"__proto__":{"$ne":"a"}}}',
            '{"id":{"$in":[1],"__proto__":1}}',
            '{"id":{"$not":{"__proto__":1}}}',
            '{"name":{"__proto__":{"x":1}}}',
            '{"name":{"$in":[{"__proto__":1}]}}',
            '{"a":{"b":{"c":{"__proto__":1}}}}',
            '{"length":1,"__proto__":{"x":1}}',
        ]
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let c of finds) {
                    let err = await quiet(() => getReject(proc('u1', 'tests', mode, parse(c))))
                    assert.strictEqual(err, msgFind(mode), `${kind} ${mode} ${c}`)
                }
            }
            assert.deepStrictEqual(calls, [], `${kind} ORM不應被呼叫`)
        }
    })

    it('P02 寫入列任何深度含自有__proto__鍵: insert、save、mix之add與diff整批reject, ORM未被呼叫', async function() {
        //R-OBJ-01 規則3: 於任何寫入之前, 訊息只列位置; 形狀檢查(R-INPUT-01)優先
        let top = '{"id":"p1","name":"x","__proto__":{"y":1}}'
        let nested = '{"id":"p2","meta":{"__proto__":{"y":1}}}'
        let inArray = '{"id":"p3","list":[{"a":1},{"__proto__":1}]}'
        let good = { id: 'g1', name: 'ok', length: 1 }
        for (let { kind, proc } of getKinds()) {
            if (kind === 'none') {
                continue
            }
            let rj = (mode, input) => quiet(() => getReject(proc('u1', 'tests', mode, input)))
            for (let c of [top, nested, inArray]) {
                assert.strictEqual(await rj('insert', [good, parse(c)]), 'failed to insert data, unsupported key[__proto__]: data[1]', `${kind} ${c}`)
                assert.strictEqual(await rj('save', [parse(c), good]), 'failed to save data, unsupported key[__proto__]: data[0]', `${kind} ${c}`)
                assert.strictEqual(await rj('insert', parse(c)), 'failed to insert data, unsupported key[__proto__]: data[0]', `${kind} 單一物件 ${c}`)
                assert.strictEqual(await rj('save', parse(c)), 'failed to save data, unsupported key[__proto__]: data[0]', `${kind} 單一物件 ${c}`)
                assert.strictEqual(await rj('mix', { add: [good, parse(c)] }), 'failed to insert data, unsupported key[__proto__]: data[1]', `${kind} ${c}`)
                assert.strictEqual(await rj('mix', { diff: [parse(c)] }), 'failed to update data, unsupported key[__proto__]: data[0]', `${kind} ${c}`)
                assert.strictEqual(await rj('mix', { add: [parse(c)], diff: [good, parse(c)] }), 'failed to insert data, unsupported key[__proto__]: data[0]; failed to update data, unsupported key[__proto__]: data[1]', `${kind} ${c}`)
            }
            assert.strictEqual(await rj('insert', [parse(top), good, parse(nested), parse(inArray)]), 'failed to insert data, unsupported key[__proto__]: data[0], data[2], data[3]', kind)

            //形狀檢查優先: 非物件之列先以 not an object 整批拒絕
            assert.strictEqual(await rj('insert', ['abc', parse(top)]), 'failed to insert data, not an object: data[0]', kind)

            //檢查順序(R-INPUT-01 規則4): __proto__ 檢查早於 R-XSS-01 之主鍵預檢與 R-MIX-01 之跨段同鍵檢查
            assert.strictEqual(await rj('insert', [parse('{"id":"<script>x</script>","__proto__":1}')]), 'failed to insert data, unsupported key[__proto__]: data[0]', kind)
            assert.strictEqual(await rj('mix', { add: [{ id: 's1' }], del: [{ id: 's1' }], diff: [parse('{"id":"d1","__proto__":1}')] }), 'failed to update data, unsupported key[__proto__]: data[0]', kind)
            assert.deepStrictEqual(calls, [], `${kind} ORM不應被呼叫`)
        }
    })

    it('P03 不在規則內者照常: null原型物件字面量、物件字面量之__proto__設原型之寫入列、mix之del列、他欄之__proto__字串值', async function() {
        //R-OBJ-01 規則3(自有鍵之定義)與已知限制(del各筆交後端)
        for (let { kind, cast, proc } of getKinds()) {
            //{ __proto__: null } 之字面量為null原型物件, 無自有__proto__鍵; 轉型表複製為一般物件, 其餘原物件交ORM
            stub.reset()
            let f = { __proto__: null, id: 'a' }
            await proc('u1', 'tests', 'select', f)
            if (cast) {
                same(calls[0].data, { id: 'a' }, `${kind} null原型之select`)
            }
            else {
                assert.strictEqual(calls[0].data, f, `${kind} 應為同一參考`)
            }

            stub.reset()
            await proc('u1', 'tests', 'select', { name: '__proto__' })
            same(calls[0].data, { name: '__proto__' }, `${kind} 值為字串__proto__之select`)

            if (kind === 'none') {
                continue
            }
            //寫入列以 { __proto__: x } 設原型(無自有鍵)者: 複製只取自有鍵, 原型不帶入
            stub.reset()
            let r = await proc('u1', 'tests', 'insert', [{ __proto__: { name: 'inherit' }, id: 'q1' }])
            same(calls[0].data, [{ id: 'q1' }], `${kind} 字面量__proto__之insert`)
            same(r, [{ id: 'q1' }], `${kind} 回傳`)

            stub.reset()
            await proc('u1', 'tests', 'mix', { del: [parse('{"id":"d1","__proto__":{"y":1}}')] })
            assert.strictEqual(calls[0].fn, 'del', `${kind} mix之del列照常交ORM`)
            assert.strictEqual(calls[0].data[0].id, 'd1')
        }
    })

    //getter, 於o定義可列舉之getter, reads計其被呼叫次數
    let reads = 0
    let getter = (o, k, f) => Object.defineProperty(o, k, {
        enumerable: true,
        configurable: true,
        get() {
            reads++; return f()
        }
    })
    let boom = (v) => () => {
        throw v
    }

    it('P04 find與寫入列含存取器屬性(getter、setter)或檢查時拋錯: 整批reject, 不呼叫getter, 不回顯其拋出之值', async function() {
        //R-OBJ-01 規則3(accessor、unreadable): getter每讀一次可能不同, 檢查之值不等於使用之值(可繞過__proto__檢查或改查另一筆), 拋錯則繞過固定訊息並回顯其值(外審 sol F1、F4, opus #2)
        reads = 0
        let revoked = Proxy.revocable({}, {})
        revoked.revoke()
        let finds = [
            ['getter', () => getter({}, 'id', () => 'a'), 'unsupported accessor property'],
            ['getter拋Error', () => getter({}, 'id', boom(new Error('SECRET-GETTER'))), 'unsupported accessor property'],
            ['getter拋字串', () => getter({}, 'id', boom('SECRET-CLIENT-VALUE')), 'unsupported accessor property'],
            ['getter於$and內', () => ({ $and: [getter({}, 'name', () => 'x')] }), 'unsupported accessor property'],
            ['getter於id條件內', () => ({ id: getter({}, '$in', () => ['a']) }), 'unsupported accessor property'],
            ['setter', () => Object.defineProperty({}, 'name', { enumerable: true, set() {} }), 'unsupported accessor property'], // eslint-disable-line accessor-pairs
            ['getter回傳含__proto__之物件', () => getter({}, 'name', () => parse('{"__proto__":1}')), 'unsupported accessor property'],
            //規則6起 find 內之Proxy(含已撤銷者)一律以 irregular reject, 且不觸發任何陷阱(寫入列之Proxy仍依下方 rows 歸入 unreadable value)
            ['已撤銷之Proxy', () => revoked.proxy, 'unsupported irregular object or array'],
            ['ownKeys陷阱拋錯', () => new Proxy({}, {
                ownKeys() {
                    throw new Error('SECRET-TRAP')
                }
            }), 'unsupported irregular object or array'],
        ]
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let [label, mk, msg] of finds) {
                    let err = await quiet(() => getReject(proc('u1', 'tests', mode, mk())))
                    assert.strictEqual(err, `invalid find of ${mode}, ${msg}`, `${kind} ${mode} ${label}`)
                }
            }
        }
        let rows = [
            ['getter', () => getter({ id: 'a' }, 'name', () => 'x'), 'unsupported accessor property'],
            ['getter拋Error', () => getter({ id: 'a' }, 'name', boom(new Error('SECRET-GETTER'))), 'unsupported accessor property'],
            ['getter拋字串', () => getter({ id: 'a' }, 'name', boom('SECRET-CLIENT-VALUE')), 'unsupported accessor property'],
            ['巢狀getter', () => ({ id: 'a', meta: getter({}, 'k', () => 1) }), 'unsupported accessor property'],
            ['陣列內物件之getter', () => ({ id: 'a', list: [getter({}, 'k', () => 1)] }), 'unsupported accessor property'],
            ['getter回傳含__proto__之物件', () => getter({ id: 'a' }, 'meta', () => parse('{"__proto__":1}')), 'unsupported accessor property'],
            ['ownKeys陷阱拋錯', () => new Proxy({ id: 'a' }, {
                ownKeys() {
                    throw new Error('SECRET-TRAP')
                }
            }), 'unreadable value'],
        ]
        for (let { kind, proc } of getKinds()) {
            if (kind === 'none') {
                continue
            }
            let rj = (mode, input) => quiet(() => getReject(proc('u1', 'tests', mode, input)))
            for (let [label, mk, msg] of rows) {
                assert.strictEqual(await rj('insert', [mk()]), `failed to insert data, ${msg}: data[0]`, `${kind} insert ${label}`)
                assert.strictEqual(await rj('save', mk()), `failed to save data, ${msg}: data[0]`, `${kind} save ${label}`)
                assert.strictEqual(await rj('mix', { add: [mk()] }), `failed to insert data, ${msg}: data[0]`, `${kind} mix.add ${label}`)
                assert.strictEqual(await rj('mix', { diff: [{ id: 'ok' }, mk()] }), `failed to update data, ${msg}: data[1]`, `${kind} mix.diff ${label}`)
            }
            //原因不同者分組列出
            assert.strictEqual(await rj('insert', [parse('{"id":"p","__proto__":1}'), getter({ id: 'q' }, 'name', () => 'x'), parse('{"id":"r","__proto__":1}')]),
                'failed to insert data, unsupported key[__proto__]: data[0], data[2]; failed to insert data, unsupported accessor property: data[1]', kind)
        }
        assert.strictEqual(reads, 0, 'getter不應被呼叫')
        assert.deepStrictEqual(calls, [], 'ORM不應被呼叫')
    })

    it('P05 陣列本身含自有__proto__鍵(不論可否列舉)亦reject; 稀疏陣列之空洞於find改為reject(規則6)', async function() {
        //R-OBJ-01 規則3: 陣列以索引迭代之例外不及於「檢查該陣列本身有無自有__proto__鍵」(外審 sol F3)
        let mkArr = (enumerable) => Object.defineProperty([1, 2], '__proto__', { value: 'SECRET', enumerable })
        for (let { kind, proc } of getKinds()) {
            for (let enumerable of [false, true]) {
                for (let mode of ['select', 'delAll']) {
                    let err = await quiet(() => getReject(proc('u1', 'tests', mode, { id: { $in: mkArr(enumerable) } })))
                    assert.strictEqual(err, `invalid find of ${mode}, unsupported key[__proto__]`, `${kind} ${mode} ${enumerable}`)
                }
                if (kind !== 'none') {
                    let err = await quiet(() => getReject(proc('u1', 'tests', 'insert', { id: 'c', meta: mkArr(enumerable) })))
                    assert.strictEqual(err, 'failed to insert data, unsupported key[__proto__]: data[0]', `${kind} insert ${enumerable}`)
                }
            }
            assert.deepStrictEqual(calls, [], `${kind} ORM不應被呼叫`)

            //稀疏陣列之空洞: 規則6起整批reject(原照常交ORM): 空洞陣列之原型可帶資料索引, 複製之map以array[index]讀到繼承值而成為密陣列(外審第二輪 A-02)
            let sparse = [1, , 3] // eslint-disable-line no-sparse-arrays
            for (let mode of ['select', 'delAll']) {
                let err = await quiet(() => getReject(proc('u1', 'tests', mode, { id: { $in: sparse } })))
                assert.strictEqual(err, `invalid find of ${mode}, unsupported irregular object or array`, `${kind} ${mode} 稀疏陣列`)
            }
            assert.deepStrictEqual(calls, [], `${kind} ORM不應被呼叫`)
        }
    })

    it('P06 批次容器(insert、save之輸入陣列索引、mix之add/del/diff屬性)為存取器: 整批reject, ORM未被呼叫', async function() {
        //R-OBJ-01 規則3(批次容器): 容器為getter時各檢查各自重讀, 前幾次讀回乾淨列令檢查通過, 其後讀回含__proto__之列或字串(外審 opus 二輪 F1)
        let n
        let mkArr = () => {
            n = 0
            return Object.defineProperty([], 0, {
                enumerable: true,
                get() {
                    n++
                    return n <= 2 ? { id: 'a', name: 'clean' } : parse('{"id":"a","__proto__":{"polluted":1}}')
                },
            })
        }
        let mkMix = (key) => {
            n = 0
            return Object.defineProperty({}, key, {
                enumerable: true,
                get() {
                    n++
                    return n <= 4 ? [{ id: 'ok' }] : [parse('{"id":"zz","__proto__":{"p":1}}'), 'str']
                },
            })
        }
        for (let { kind, proc } of getKinds()) {
            if (kind === 'none') {
                continue
            }
            let rj = (mode, input) => quiet(() => getReject(proc('u1', 'tests', mode, input)))
            assert.strictEqual(await rj('insert', mkArr()), 'failed to insert data, unsupported accessor property: data[0]', `${kind} insert`)
            assert.strictEqual(await rj('save', mkArr()), 'failed to save data, unsupported accessor property: data[0]', `${kind} save`)
            for (let key of ['add', 'del', 'diff']) {
                assert.strictEqual(await rj('mix', mkMix(key)), 'invalid input of mix, unsupported accessor property', `${kind} mix.${key}`)
            }
        }
        assert.deepStrictEqual(calls, [], 'ORM不應被呼叫')
    })

    it('P07 偽造Symbol.toStringTag為Array之物件不當陣列走訪: 不呼叫其length getter(規則6起整批reject)', async function() {
        //R-OBJ-01 規則3(陣列之判定用Array.isArray): isarr以Object.prototype.toString判定可被偽造, 走訪時讀其length(外審 opus 二輪 F6)
        //規則6(2026-10-19): 原照常交ORM, 現以 irregular reject(isarr與Array.isArray不一致者, 轉型表之lodash map會讀其length並複製成真陣列); 仍不呼叫length getter
        let reads = 0
        let fake = { [Symbol.toStringTag]: 'Array' }
        Object.defineProperty(fake, 'length', {
            enumerable: true,
            get() {
                reads++
                return 3
            },
        })
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let find of [{ name: { $eq: fake } }, { id: { $in: fake } }, { id: { $eq: fake } }]) {
                    let err = await quiet(() => getReject(proc('u1', 'tests', mode, find)))
                    assert.strictEqual(err, `invalid find of ${mode}, unsupported irregular object or array`, `${kind} ${mode} ${JSON.stringify(Object.keys(find))}`)
                }
            }
            assert.strictEqual(reads, 0, `${kind} length getter不應被呼叫`)
            assert.deepStrictEqual(calls, [], `${kind} ORM不應被呼叫`)
        }
    })

    it('K01 欄位值內具整數length鍵之巢狀物件, 其內字串亦須被清除且不新增索引鍵', async function() {
        //R-OBJ-01: wsemi 1.9.17 以前之 clearXSS 以 lodash each 遞迴巢狀物件, {length:3,a:'<script>'} 之 a 不被清除並新增 0、1、2 鍵,
        //length 極大時更於複本建立同數量之屬性而耗盡記憶體(外審 opus #1); wsemi 1.9.18 已修, 本案自此啟用
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        await so.procOrm('u1', 'tests', 'insert', [{ id: 'k1', meta: { length: 3, a: '<script>alert(1)</script>' } }])
        same(calls[0].data[0].meta, { length: 3, a: '&lt;script>alert(1)&lt;/script>' }, '巢狀物件之清除')
    })

})


describe('R-INPUT-01 規則3 select與delAll之find須為物件', function() {

    beforeEach(function() {
        stub.reset()
    })

    //非條件物件之語料(dspec 一之一第2點: null、陣列、字串、數值、布林、函數、Date、RegExp、Map、Set)
    let bads = [
        ['null', null],
        ['[]', []],
        ['array-string', ['a']],
        ['array-object', [{ id: 'a' }]],
        ['string', 'a'],
        ['empty-string', ''],
        ['5', 5],
        ['0', 0],
        ['NaN', NaN],
        ['true', true],
        ['false', false],
        ['function', () => ({})],
        ['Date', new Date(0)],
        ['RegExp', /x/],
        ['Map', new Map()],
        ['Set', new Set()],
        //isobj為真(或可被偽造為真)但非純物件: 自有可列舉鍵可能為空而在轉型表被複製成{}, 令條件消失(select回全表、delAll刪全表), 故一律reject(外審 opus #4、sol F2)
        ['類別實例', new (class A {
            constructor() {
                this.name = 'x'
            }
        })()],
        ['類別實例(欄位為原型getter)', new (class B {
            get name() {
                return 'x'
            }
        })()],
        ['Object.create(proto)', Object.create({ name: 'x' })],
        //原型為「null 原型之一般物件」: 條件繼承自原型,自有鍵為空;「原型之原型為 null」不是根原型之充分條件(外審 opus 二輪 F2,真 lowdb 上 delAll 刪全表)
        ['原型為null原型物件之物件', Object.create(Object.assign(Object.create(null), { name: 'alpha' }))],
        ['原型為null原型空物件之物件', Object.create(Object.create(null))],
        ['原型為null原型物件且帶非Object之constructor', Object.create(Object.assign(Object.create(null), { constructor: class Foo {} }))],
        ['偽造Symbol.toStringTag之Map', Object.defineProperty(new Map([['id', 'a']]), Symbol.toStringTag, { value: 'Object' })],
        ['偽造Symbol.toStringTag之包裝數值', Object.defineProperty(Object(1), Symbol.toStringTag, { value: 'Object' })],
        ['new String', new String('a')], // eslint-disable-line no-new-wrappers
        ['Object(1)', Object(1)],
        ['arguments', (function() {
            return arguments
        })('a')],
    ]

    it('D01 find給予而非純物件: select與delAll皆整批reject, ORM未被呼叫(四種資料表型態)', async function() {
        //R-INPUT-01 規則3; 檢查早於轉型, 故與isIdCast無關
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let [label, find] of bads) {
                    let err = await quiet(() => getReject(proc('u1', 'tests', mode, find)))
                    assert.strictEqual(err, `invalid find of ${mode}, need an object`, `${kind} ${mode} ${label}`)
                }
            }
            assert.deepStrictEqual(calls, [], `${kind} ORM不應被呼叫`)
        }
    })

    it('D02 find未給、undefined、{}與一般條件: 照常交ORM(無條件), 實參不變', async function() {
        //R-INPUT-01 規則3、dspec 一之一第1點: 三者皆為全部
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                stub.reset()
                await proc('u1', 'tests', mode)
                await proc('u1', 'tests', mode, undefined)
                await proc('u1', 'tests', mode, {})
                await proc('u1', 'tests', mode, { name: 'x' })
                assert.deepStrictEqual(calls.map((c) => c.fn), [mode, mode, mode, mode], kind)
                same(calls.map((c) => c.data), [undefined, undefined, {}, { name: 'x' }], `${kind} ${mode}`)
            }
        }
    })

    it('D04 特殊但合法之純物件照常: null原型、跨realm(vm)、含陣列與巢狀之條件', async function() {
        //R-INPUT-01 規則3(純物件之定義: 原型為null或根原型, 故跨realm之物件通過); 外審 opus 類別3、sol: D01 只測應reject者, 判準改嚴時不會被發現誤擋
        let nullProto = Object.assign(Object.create(null), { name: 'x', length: 1 })
        let crossRealm = vm.runInNewContext('({ name: "x", length: 1, $or: [{ id: "a" }, { name: "b" }] })')
        for (let { kind, cast, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let [label, find, expected] of [
                    ['null原型', nullProto, { name: 'x', length: 1 }],
                    ['跨realm', crossRealm, { name: 'x', length: 1, $or: [{ id: 'a' }, { name: 'b' }] }],
                ]) {
                    stub.reset()
                    await proc('u1', 'tests', mode, find)
                    assert.strictEqual(calls.length, 1, `${kind} ${mode} ${label}`)
                    if (cast) {
                        //轉型表複製: 自有鍵與值相同, 原型為本realm之Object.prototype
                        assert.deepStrictEqual(Object.keys(calls[0].data), Object.keys(expected), `${kind} ${mode} ${label} 鍵`)
                        assert.strictEqual(Object.getPrototypeOf(calls[0].data), Object.prototype)
                        assert.strictEqual(calls[0].data.length, 1)
                    }
                    else {
                        assert.strictEqual(calls[0].data, find, `${kind} ${mode} ${label} 應為同一參考`)
                    }
                }
            }
        }
    })

    it('D03 reject為字串且不回顯客戶端之值; 前處理改成非物件者亦被擋', async function() {
        //R-ERR-01 規則1(字串)、R-MSG-01(訊息不回顯); 檢查作用於前處理之後之input(R-HOOK-01)
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        let err = await quiet(() => getReject(so.procOrm('u1', 'tests', 'select', 'SECRET-VALUE')))
        assert.strictEqual(typeof err, 'string')
        assert.ok(!err.includes('SECRET'), err)
        so.addFunPreProcessing(({ input }) => ({ input: input === undefined ? null : input }))
        await wait(20)
        let err2 = await quiet(() => getReject(so.procOrm('u1', 'tests', 'select')))
        assert.strictEqual(err2, 'invalid find of select, need an object')
        assert.deepStrictEqual(calls, [])
    })

})


describe('R-OBJ-01 規則6 find之複本須與原物件等價', function() {

    beforeEach(function() {
        stub.reset()
    })

    let hide = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true })
    class Cls {
        constructor(o) {
            Object.assign(this, o)
        }
    }
    class TagG {
        get [Symbol.toStringTag]() {
            return 'Object'
        }
    }
    //偽原型之constructor自洽: 鍵名同Object.prototype, constructor 為另一函數且其 prototype 指回偽原型(通過鍵名與指回檢查, 只有原始碼比對能辨)
    let mkSelfCtor = () => {
        let p = mkForged12()
        let F = function() {}
        F.prototype = p
        Object.defineProperty(p, 'constructor', { value: F, enumerable: false, configurable: true, writable: true })
        return p
    }
    //KeyObject(原型改為null): 無自有鍵、可結構化複製、不在 util.types 品牌清單內, 專供驗證 structuredClone 網
    let keyObj = () => Object.setPrototypeOf(createSecretKey(Buffer.alloc(16)), null)
    //包 k 層 {$and:[…]}: 容器層數增 2k(根為第 1 層)
    let wrapAnd = (inner, k) => {
        for (let i = 0; i < k; i++) {
            inner = { $and: [inner] }
        }
        return inner
    }
    let msgHidden = 'unsupported symbol key or non-enumerable property'
    let msgIrreg = 'unsupported irregular object or array'
    let fakeArr = (a) => Object.assign({ length: a.length, [Symbol.toStringTag]: 'Array' }, a) //宣稱Symbol.toStringTag為Array: isarr為真而Array.isArray為假

    it('D05 find內有Symbol鍵、不可列舉鍵、非純物件、不規則陣列: select與delAll皆整批reject固定字串, ORM未被呼叫(四種資料表型態)', async function() {
        //R-OBJ-01 規則6(hidden、irregular): 字串型主鍵表之複本(mapOwn、lodash map)洗掉這些結構, 令後端白名單版本會reject之條件變成較寬或無條件(外審 sol F1)
        let cases = [
            //hidden: 物件節點之Symbol鍵與不可列舉鍵, 位置含頂層、$and/$or元素、巢狀、id運算子物件、非id欄位之運算子物件
            ['頂層Symbol鍵(僅此鍵)', () => ({ [Symbol('s')]: 1 }), msgHidden],
            ['頂層不可列舉id(僅此鍵)', () => hide({}, 'id', 'a1'), msgHidden],
            ['頂層Symbol鍵並有其他鍵', () => Object.assign({ id: 'a1' }, { [Symbol('s')]: 1 }), msgHidden],
            ['頂層另有不可列舉鍵', () => hide({ id: 'a1' }, 'name', 'x'), msgHidden],
            ['$and元素Symbol鍵', () => ({ $and: [Object.assign({ id: 'a1' }, { [Symbol('s')]: 1 })] }), msgHidden],
            ['$or元素不可列舉鍵', () => ({ $or: [hide({ id: 'a1' }, 'zz', 1)] }), msgHidden],
            ['巢狀$and→$or元素Symbol鍵', () => ({ $and: [{ $or: [Object.assign({ name: 'x' }, { [Symbol('s')]: 1 })] }] }), msgHidden],
            ['id運算子物件Symbol鍵', () => ({ id: Object.assign({ $eq: 'a1' }, { [Symbol('s')]: 1 }) }), msgHidden],
            ['id運算子物件之$in為不可列舉', () => ({ id: hide({}, '$in', ['a1']) }), msgHidden],
            ['非id欄位運算子物件不可列舉鍵', () => ({ name: hide({ $eq: 'x' }, 'zz', 1) }), msgHidden],
            ['null原型物件之Symbol鍵', () => Object.assign(Object.create(null), { id: 'a1', [Symbol('s')]: 1 }), msgHidden],
            //irregular: 巢狀位置之非純物件(頂層由 need an object 先擋)
            ['$and元素為類別實例', () => ({ $and: [new Cls({ id: 'a1' })] }), msgIrreg],
            ['$or元素為Object.create(proto)', () => ({ $or: [Object.create({ id: 'a1' })] }), msgIrreg],
            ['id運算子物件為類別實例', () => ({ id: new Cls({ $in: ['a1'] }) }), msgIrreg],
            ['非id欄位運算子物件為類別實例', () => ({ name: new Cls({ $eq: 'x' }) }), msgIrreg],
            ['巢狀元素為偽造標籤之Map', () => ({ $and: [Object.defineProperty(new Map([['id', 'a1']]), Symbol.toStringTag, { value: 'Object' })] }), msgIrreg],
            //irregular: 陣列節點
            ['$in陣列額外可列舉屬性', () => ({ id: { $in: Object.assign(['a1'], { extra: 1 }) } }), msgIrreg],
            ['$in陣列額外不可列舉屬性', () => ({ id: { $in: hide(['a1'], 'extra', 1) } }), msgIrreg],
            ['$in陣列Symbol鍵', () => ({ id: { $in: Object.assign(['a1'], { [Symbol('s')]: 1 }) } }), msgIrreg],
            ['$in陣列不可列舉元素', () => ({ id: { $in: hide(['a1'], '0', 'a1') } }), msgIrreg],
            ['$nin陣列額外屬性(非id欄位)', () => ({ name: { $nin: Object.assign(['x'], { extra: 1 }) } }), msgIrreg],
            ['$and陣列額外屬性', () => ({ $and: Object.assign([{ id: 'a1' }], { extra: 1 }) }), msgIrreg],
            ['$or陣列Symbol鍵', () => ({ $or: Object.assign([{ id: 'a1' }], { [Symbol('s')]: 1 }) }), msgIrreg],
            ['$and陣列不可列舉元素', () => ({ $and: hide([{ id: 'a1' }], '0', { id: 'a1' }) }), msgIrreg],
            ['空洞並有額外屬性', () => ({ id: { $in: Object.assign(['a1', , 'a3'], { extra: 1 }) } }), msgIrreg], // eslint-disable-line no-sparse-arrays
            ['偽造標籤為Array之物件於$and', () => ({ $and: fakeArr([{ id: 'a1' }]) }), msgIrreg],
            ['偽造標籤為Array之物件於$or', () => ({ $or: fakeArr([{ id: 'a1' }]) }), msgIrreg],
            ['偽造標籤為Array之物件於id.$in', () => ({ id: { $in: fakeArr(['a1']) } }), msgIrreg],
            ['偽造標籤為Array之物件於id.$eq', () => ({ id: { $eq: fakeArr(['a1']) } }), msgIrreg],
            ['偽造標籤為Array之物件於非id欄位', () => ({ name: { $in: fakeArr(['x']) } }), msgIrreg],
            ['真陣列由原型設標籤為Object', () => ({ id: { $in: Object.setPrototypeOf(['a1'], Object.create(Array.prototype, { [Symbol.toStringTag]: { value: 'Object' } })) } }), msgIrreg],
            ['真陣列由原型設標籤為Object於$and元素', () => ({ $and: [Object.setPrototypeOf(['a1'], Object.create(Array.prototype, { [Symbol.toStringTag]: { value: 'Object' } }))] }), msgIrreg],
            ['真陣列由原型設標籤為getter', () => ({ id: { $in: Object.setPrototypeOf(['a1'], Object.create(Array.prototype, { [Symbol.toStringTag]: { get: () => 'Array' } })) } }), msgIrreg],
            ['類別實例之標籤為getter於$and元素', () => ({ $and: [new TagG()] }), msgIrreg],
            //深度邊界(第64層仍受strict檢查; 真陣列之標籤getter只有標籤檢查能辨, 直呼後端本接受, 故於此以替身ORM鎖定)
            ['標籤為getter之真陣列恰在第64層', () => wrapAnd({ $and: Object.setPrototypeOf([{ id: 'a1' }], Object.create(Array.prototype, { [Symbol.toStringTag]: { get: () => 'Array' } })) }, 31), msgIrreg],
            ['標籤為getter之真陣列在第64層以內(第2層)', () => ({ $and: Object.setPrototypeOf([{ id: 'a1' }], Object.create(Array.prototype, { [Symbol.toStringTag]: { get: () => 'Array' } })) }), msgIrreg],
            //空洞: 密陣列才可交複製(繼承之索引會被map讀到, 外審 A-02)
            ['空洞於$in', () => ({ id: { $in: ['a1', , 'a3'] } }), msgIrreg], // eslint-disable-line no-sparse-arrays
            ['空洞於$and', () => ({ $and: [{ id: 'a1' }, , { id: 'a3' }] }), msgIrreg], // eslint-disable-line no-sparse-arrays
            ['空洞且原型帶資料索引於$in', () => ({ id: { $in: Object.setPrototypeOf(new Array(1), Object.assign(Object.create(Array.prototype), { 0: 'a1' })) } }), msgIrreg],
            ['空洞且原型帶資料索引於$and', () => ({ $and: Object.setPrototypeOf(new Array(1), Object.assign(Object.create(Array.prototype), { 0: { id: 'a1' } })) }), msgIrreg],
            //內建品牌物件之原型改為null或Object.prototype: 內部槽不在自有鍵中, 無標籤可辨, 複本會洗成{}(外審 A-01), 由structuredClone網抓
            ['原型為null之Map於頂層', () => Object.setPrototypeOf(new Map([['id', 'a1']]), null), msgIrreg],
            ['原型為Object.prototype之Map於頂層', () => Object.setPrototypeOf(new Map([['id', 'a1']]), Object.prototype), msgIrreg],
            ['原型為null之Set於$and元素', () => ({ $and: [Object.setPrototypeOf(new Set(['a1']), null)] }), msgIrreg],
            ['原型為null之WeakMap於id運算子位置', () => ({ id: Object.setPrototypeOf(new WeakMap(), null) }), msgIrreg],
            ['原型為null之Promise於$or元素', () => ({ $or: [Object.setPrototypeOf(Promise.resolve(0), null)] }), msgIrreg],
            ['原型為null之ArrayBuffer於頂層', () => Object.setPrototypeOf(new ArrayBuffer(1), null), msgIrreg],
            ['原型為null之DataView於頂層', () => Object.setPrototypeOf(new DataView(new ArrayBuffer(1)), null), msgIrreg],
            ['原型為null之零長TypedArray於id運算子位置', () => ({ id: Object.setPrototypeOf(new Uint8Array(0), null) }), msgIrreg],
            ['原型為null之Symbol包裝物件於頂層', () => Object.setPrototypeOf(Object(Symbol('s')), null), msgIrreg],
            ['原型為null之BigInt包裝物件於$and元素', () => ({ $and: [Object.setPrototypeOf(Object(1n), null)] }), msgIrreg],
            //偽原型: 只有constructor一鍵, 通過lodash式純物件判準而後端要求本realm之Object.prototype或null(外審第二輪)
            ['偽原型之頂層', () => Object.create(Object.assign(Object.create(null), { constructor: Object })), 'need an object'],
            ['偽原型之$and元素', () => ({ $and: [Object.create(Object.assign(Object.create(null), { constructor: Object }))] }), msgIrreg],
            ['偽原型之id運算子物件', () => ({ id: Object.assign(Object.create(Object.assign(Object.create(null), { constructor: Object })), { $in: ['a1'] }) }), msgIrreg],
            //函數與Symbol值: typeof非object不被走訪, 帶標籤之函數會被isobj當物件複製(外審 A-03); 由structuredClone網抓(後端本即reject)
            ['帶Object標籤之函數於id運算子位置', () => ({ id: Object.assign(function() {}, { $eq: 'a1', [Symbol.toStringTag]: 'Object' }) }), msgIrreg],
            ['帶Object標籤之函數於$and元素', () => ({ $and: [Object.assign(function() {}, { id: 'a1', [Symbol.toStringTag]: 'Object' })] }), msgIrreg],
            ['帶Array標籤之函數於$in', () => ({ id: { $in: Object.assign(function() {}, { [Symbol.toStringTag]: 'Array' }) } }), msgIrreg],
            ['函數值', () => ({ id: { $eq: function() {} } }), msgIrreg],
            ['Symbol值', () => ({ name: Symbol('x') }), msgIrreg],
            //Proxy: 陷阱可令檢查之值不等於使用之值, 一律reject(陷阱拋錯者由P04以unreadable處理)
            ['Proxy包裝之一般物件於頂層', () => new Proxy({ id: 'a1' }, {}), msgIrreg],
            ['Proxy包裝之一般物件於$and元素', () => ({ $and: [new Proxy({ id: 'a1' }, {})] }), msgIrreg],
            ['陣列之原型為Proxy', () => ({ id: { $in: Object.setPrototypeOf(['a1'], new Proxy(Array.prototype, {})) } }), msgIrreg],
            ['陣列之原型為Proxy於$and', () => ({ $and: Object.setPrototypeOf([{ id: 'a1' }], new Proxy(Array.prototype, {})) }), msgIrreg],
            //偽原型(外審第二輪 A-01、A-03): 自有鍵名同Object.prototype, constructor 為本realm之Object, 但其prototype不指回偽原型; 或constructor為getter
            ['仿Object.prototype之偽原型於頂層', () => Object.create(mkForged12()), 'need an object'],
            ['仿Object.prototype之偽原型於$and元素', () => ({ $and: [Object.assign(Object.create(mkForged12()), { id: 'a1' })] }), msgIrreg],
            ['仿Object.prototype之偽原型於id運算子物件', () => ({ id: Object.assign(Object.create(mkForged12()), { $in: ['a1'] }) }), msgIrreg],
            ['偽原型之constructor為getter於頂層', () => Object.create(mkForged12({ get: () => Object, enumerable: false, configurable: true })), 'need an object'],
            ['偽原型之constructor為getter於$and元素', () => ({ $and: [Object.create(mkForged12({ get: () => Object, enumerable: false, configurable: true }))] }), msgIrreg],
            ['偽原型多一個繼承鍵(鍵名為Object.prototype之超集)於頂層', () => Object.create(Object.defineProperty(mkForged12(), 'id', { value: 'a1', enumerable: true })), 'need an object'],
            ['偽原型多一個繼承鍵(鍵名為Object.prototype之超集)於$and元素', () => ({ $and: [Object.create(Object.defineProperty(mkForged12(), 'id', { value: 'a1', enumerable: true }))] }), msgIrreg],
            ['偽原型之constructor自洽(其prototype指回偽原型)但原始碼不同於Object於頂層', () => Object.create(mkSelfCtor()), 'need an object'],
            ['偽原型之constructor自洽(其prototype指回偽原型)但原始碼不同於Object於$and元素', () => ({ $and: [Object.create(mkSelfCtor())] }), msgIrreg],
            ['偽原型之constructor為class且鍵名同Object.prototype', () => ({ $and: [Object.create(mkForged12({ value: class Foo {}, enumerable: false, configurable: true, writable: true }))] }), msgIrreg],
            //真的另一個realm之Object.prototype(指回檢查與原始碼比對皆通過), 只多一個鍵: 只有鍵數檢查能辨
            ['跨realm之Object.prototype被加id(鍵名超集)於頂層', () => vm.runInNewContext('Object.prototype.id = "a1"; ({})'), 'need an object'],
            ['跨realm之Object.prototype被加id(鍵名超集)於$and元素', () => ({ $and: [vm.runInNewContext('Object.prototype.id = "a1"; ({})')] }), msgIrreg],
            ['跨realm之Object.prototype被刪valueOf並加id於頂層', () => vm.runInNewContext('delete Object.prototype.valueOf; Object.prototype.id = "a1"; ({})'), 'need an object'],
            ['跨realm之Object.prototype被刪valueOf並加id於$and元素', () => ({ $and: [vm.runInNewContext('delete Object.prototype.valueOf; Object.prototype.id = "a1"; ({})')] }), msgIrreg],
            //Date帶自有屬性(外審第二輪 A-06): 葉節點仍須乾淨
            ['Date帶自有屬性於欄位值', () => ({ name: Object.assign(new Date(0), { x: 1 }) }), msgIrreg],
            ['Date帶自有__proto__鍵於比較運算子', () => ({ name: { $gt: Object.defineProperty(new Date(0), '__proto__', { value: 1, enumerable: true }) } }), msgIrreg],
            ['Date帶不可列舉屬性', () => ({ name: hide(new Date(0), 'zz', 1) }), msgIrreg],
            ['Date帶getter', () => ({ name: Object.defineProperty(new Date(0), 'g', { get: () => 1, enumerable: true }) }), msgIrreg],
            //品牌物件在較後之兄弟位置(外審第二輪 C-02: 只走訪第0個鍵/元素之變異須轉紅); KeyObject 不在 util.types 品牌清單內, 由結構化複製網抓(Blob 帶自有 Symbol 鍵, 先被 hidden 抓到, 不適用)
            ['品牌物件為第2個鍵', () => ({ name: 'x', id: Object.setPrototypeOf(new Map(), null) }), msgIrreg],
            ['KeyObject(原型null)為第2個鍵', () => ({ name: 'x', id: keyObj() }), msgIrreg],
            ['KeyObject(原型null)為頂層', () => keyObj(), msgIrreg],
            ['KeyObject(原型null)為$and第2個元素', () => ({ $and: [{ id: 'a1' }, keyObj()] }), msgIrreg],
            ['KeyObject(原型null)為$or第3個元素', () => ({ $or: [{ id: 'a1' }, { id: 'a2' }, keyObj()] }), msgIrreg],
            ['KeyObject(原型null)為id運算子物件之第2個鍵', () => ({ id: { $eq: 'a1', $ne: keyObj() } }), msgIrreg],
            ['Proxy為$and第2個元素', () => ({ $and: [{ id: 'a1' }, new Proxy({ id: 'a2' }, {})] }), msgIrreg],
            ['帶標籤之函數為$or第3個元素', () => ({ $or: [{ id: 'a1' }, { id: 'a2' }, Object.assign(function() {}, { id: 'a3', [Symbol.toStringTag]: 'Object' })] }), msgIrreg],
            ['品牌物件為$in之後續位置(陣列元素)', () => ({ id: { $in: ['a1', Object.setPrototypeOf(new Set(), null)] } }), msgIrreg],
            //檢查順序: 自有__proto__鍵 > 非純物件 > 隱藏鍵 > 存取器
            ['類別實例且有Symbol鍵: 非純物件優先', () => ({ $and: [Object.assign(new Cls({ id: 'a1' }), { [Symbol('s')]: 1 })] }), msgIrreg],
            ['Symbol鍵且有存取器: 隱藏鍵優先', () => Object.assign(Object.defineProperty({}, 'id', { enumerable: true, get: () => 'a1' }), { [Symbol('s')]: 1 }), msgHidden],
        ]
        let done = 0
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let [label, mk, msg] of cases) {
                    let err = await quiet(() => getReject(proc('u1', 'tests', mode, mk()))).catch((e) => assert.fail(`${kind} ${mode} ${label} ${e.message}`))
                    assert.strictEqual(err, `invalid find of ${mode}, ${msg}`, `${kind} ${mode} ${label}`)
                    done++
                }
            }
            assert.deepStrictEqual(calls, [], `${kind} ORM不應被呼叫`)
        }
        assert.strictEqual(cases.length, 91, '語料數')
        assert.strictEqual(done, 91 * 2 * 4, '完成數(語料 × 2 mode × 4 種資料表型態)')
    })

    it('D05b 檢查順序: 自有__proto__鍵優先於隱藏鍵與非純物件; 檢查不呼叫getter與length getter', async function() {
        //R-OBJ-01 規則3、6: 檢查以屬性描述子與ownKeys讀取, 不呼叫getter; 偽造標籤之物件於分類時只讀標籤不讀length
        let reads = 0
        let counted = Object.defineProperty({ [Symbol.toStringTag]: 'Array' }, 'length', {
            enumerable: true,
            get() {
                reads++
                return 1
            },
        })
        let withGetter = Object.defineProperty({ [Symbol('s')]: 1 }, 'id', {
            enumerable: true,
            get() {
                reads++
                return 'a1'
            },
        })
        //標籤為繼承之getter: 分類(isobj、isarr)讀標籤時會執行, 檢查與複製各執行一次可回傳不同值(外審第二輪 B-01); 分類器以 in 運算子判斷標籤而不讀它
        let tagReads = 0
        let tagGetterProto = (base) => Object.create(base, {
            [Symbol.toStringTag]: {
                get() {
                    tagReads++
                    return 'Array'
                },
            },
        })
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let [label, find, msg] of [
                    ['陣列於id.$in', { id: { $in: Object.setPrototypeOf(['a1'], tagGetterProto(Array.prototype)) } }, msgIrreg],
                    ['陣列於$and', { $and: Object.setPrototypeOf([{ id: 'a1' }], tagGetterProto(Array.prototype)) }, msgIrreg],
                    ['物件於$and元素', { $and: [Object.create(tagGetterProto(Object.prototype))] }, msgIrreg],
                    ['頂層(isPlainObj亦不讀標籤)', Object.create(tagGetterProto(Object.prototype)), 'need an object'],
                ]) {
                    let e = await quiet(() => getReject(proc('u1', 'tests', mode, find)))
                    assert.strictEqual(e, `invalid find of ${mode}, ${msg}`, `${kind} ${mode} 標籤getter ${label}`)
                }
                let e1 = await quiet(() => getReject(proc('u1', 'tests', mode, Object.assign(parse('{"__proto__":1}'), { [Symbol('s')]: 1 }))))
                assert.strictEqual(e1, `invalid find of ${mode}, unsupported key[__proto__]`, `${kind} ${mode} proto優先`)
                let e2 = await quiet(() => getReject(proc('u1', 'tests', mode, { id: { $in: counted } })))
                assert.strictEqual(e2, `invalid find of ${mode}, ${msgIrreg}`, `${kind} ${mode} 偽造陣列`)
                let e3 = await quiet(() => getReject(proc('u1', 'tests', mode, withGetter)))
                assert.strictEqual(e3, `invalid find of ${mode}, ${msgHidden}`, `${kind} ${mode} 隱藏鍵優先於存取器`)
            }
        }
        assert.strictEqual(reads, 0, 'getter與length getter不應被呼叫')
        assert.strictEqual(tagReads, 0, '標籤getter不應被呼叫')
        assert.deepStrictEqual(calls, [], 'ORM不應被呼叫')
    })

    it('D05c 檢查期間不執行使用端程式: Proxy之陷阱、原型為Proxy、自摘除之Proxy、偽原型之constructor getter、Date之getter皆不被呼叫, 條件不被改動', async function() {
        //R-OBJ-01 規則6(外審第二輪 A-02~A-04、A-06): 陷阱或getter可在檢查途中改動已檢查之條件(檢查之值不等於使用之值); 檢查以util.types.isProxy(不觸發陷阱)與原型鏈描述子判斷, 不用 in 運算子與 p.constructor
        let done = 0
        let traps = 0
        let ctorReads = 0
        let dateReads = 0
        let ctorDesc = {
            get() {
                ctorReads++
                return Object
            },
            enumerable: false,
            configurable: true,
        }
        let dateDesc = {
            get() {
                dateReads++
                return 1
            },
            enumerable: true,
        }
        //每個陷阱皆計數後轉發
        let counting = () => new Proxy({}, {
            get: (t, name) => (...a) => {
                traps++
                return Reflect[name](...a)
            },
        })
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                //自摘除之Proxy: 任一陷阱被呼叫即清空根條件
                let root = { id: 'a1' }
                let detach = new Proxy({ id: 'a2' }, new Proxy({}, {
                    get: (t, name) => (...a) => {
                        traps++
                        delete root.id
                        delete root.$and
                        return Reflect[name](...a)
                    },
                }))
                root.$and = [detach]
                let cases = [
                    ['Proxy於頂層', new Proxy({ id: 'a1' }, counting()), 'irregular'],
                    ['Proxy於$and元素', { $and: [new Proxy({ id: 'a1' }, counting())] }, 'irregular'],
                    ['Proxy於id運算子物件', { id: new Proxy({ $in: ['a1'] }, counting()) }, 'irregular'],
                    ['Proxy陣列於$in', { id: { $in: new Proxy(['a1'], counting()) } }, 'irregular'],
                    ['陣列之原型為Proxy於$in', { id: { $in: Object.setPrototypeOf(['a1'], new Proxy(Array.prototype, counting())) } }, 'irregular'],
                    ['陣列之原型為Proxy於$and', { $and: Object.setPrototypeOf([{ id: 'a1' }], new Proxy(Array.prototype, counting())) }, 'irregular'],
                    ['物件之原型為Proxy', { $and: [Object.create(new Proxy(Object.prototype, counting()))] }, 'irregular'],
                    ['自摘除之Proxy於$and元素', root, 'irregular'],
                    ['偽原型之constructor為getter於$and元素', { $and: [Object.create(mkForged12(ctorDesc))] }, 'irregular'],
                    ['偽原型之constructor為getter於頂層', Object.create(mkForged12(ctorDesc)), 'need an object'],
                    ['Date帶getter', { name: Object.defineProperty(new Date(0), 'g', dateDesc) }, 'irregular'],
                ]
                assert.strictEqual(cases.length, 11, '語料數')
                for (let [label, find, msg] of cases) {
                    let e = await quiet(() => getReject(proc('u1', 'tests', mode, find))).catch((err) => assert.fail(`${kind} ${mode} ${label} ${err.message}`))
                    assert.strictEqual(e, `invalid find of ${mode}, ${msg === 'irregular' ? msgIrreg : msg}`, `${kind} ${mode} ${label}`)
                    done++
                }
                assert.strictEqual(root.id, 'a1', `${kind} ${mode} 根條件不被自摘除之Proxy改動`)
                assert.strictEqual(root.$and.length, 1)
            }
        }
        assert.strictEqual(done, 11 * 2 * 4, '完成數(語料 × 2 mode × 4 種資料表型態)')
        assert.strictEqual(traps, 0, 'Proxy之陷阱不應被呼叫')
        assert.strictEqual(ctorReads, 0, '偽原型之constructor getter不應被呼叫')
        assert.strictEqual(dateReads, 0, 'Date之getter不應被呼叫')
        assert.deepStrictEqual(calls, [], 'ORM不應被呼叫')
    })

    it('D05d 品牌物件之探針不依賴 structuredClone: 全域 structuredClone 被移除時, 原型改為null之內建品牌物件仍被reject', async function() {
        //R-OBJ-01 規則6(外審第二輪 B-01): util.types 為主要探針, structuredClone 為通用網; 無 structuredClone 之環境不致 fail-open 於常見內建品牌物件
        let orig = globalThis.structuredClone
        let done = 0
        let nul = (o) => Object.setPrototypeOf(o, null)
        try {
            globalThis.structuredClone = undefined
            assert.strictEqual(typeof structuredClone, 'undefined')
            for (let { kind, proc } of getKinds()) {
                for (let mode of ['select', 'delAll']) {
                    for (let [label, mk] of [
                        ['Map', () => nul(new Map([['id', 'a1']]))],
                        ['Set', () => nul(new Set(['a1']))],
                        ['WeakMap', () => nul(new WeakMap())],
                        ['WeakSet', () => nul(new WeakSet())],
                        ['Promise', () => nul(Promise.resolve(0))],
                        ['ArrayBuffer', () => nul(new ArrayBuffer(1))],
                        ['DataView', () => nul(new DataView(new ArrayBuffer(1)))],
                        ['Uint8Array', () => nul(new Uint8Array(0))],
                        ['Buffer', () => nul(Buffer.alloc(0))],
                        ['Symbol包裝物件', () => nul(Object(Symbol('s')))],
                        ['BigInt包裝物件', () => nul(Object(1n))],
                        ['Number包裝物件', () => nul(Object(1))],
                        ['RegExp', () => nul(/x/)],
                        ['Error', () => nul(new Error('x'))],
                        ['WeakRef', () => nul(new WeakRef({}))], //util.types 無對應判定, 由 WeakRef.prototype.deref 之精確探針(規則6 ⑥)
                        ['FinalizationRegistry', () => nul(new FinalizationRegistry(() => {}))], //同上, FinalizationRegistry.prototype.unregister
                    ]) {
                        for (let [pos, build] of [['頂層', (n) => n], ['$and元素', (n) => ({ $and: [n] })], ['id運算子位置', (n) => ({ id: n })]]) {
                            let e = await quiet(() => getReject(proc('u1', 'tests', mode, build(mk())))).catch((err) => assert.fail(`${kind} ${mode} ${label} ${pos} ${err.message}`))
                            //頂層: 內部標籤非 Object 者(Number 包裝物件、RegExp、Error)isobj 為假, 由 getErrFind 先以 need an object 回絕
                            let msg = pos === '頂層' && ['Number包裝物件', 'RegExp', 'Error'].includes(label) ? 'need an object' : msgIrreg
                            assert.strictEqual(e, `invalid find of ${mode}, ${msg}`, `${kind} ${mode} ${label} ${pos}`)
                            done++
                        }
                    }
                }
            }
        }
        finally {
            globalThis.structuredClone = orig
        }
        assert.strictEqual(typeof structuredClone, 'function', 'structuredClone 已還原')
        assert.strictEqual(done, 16 * 3 * 2 * 4, '完成數(16 種品牌物件 × 3 位置 × 2 mode × 4 種資料表型態)')
        assert.deepStrictEqual(calls, [], 'ORM不應被呼叫')
    })

    it('D07 被拒之find的診斷輸出不執行使用端程式, 亦不改動使用端物件: 標籤getter、inspect.custom、Proxy目標之標籤getter皆0次, 同一物件再送另一動作仍reject(四種資料表型態)', async function() {
        //R-OBJ-01 規則6 ⑤(sol 外審最終版 R3-01): 原 logSafe(label, input) 以 util.inspect 格式化原物件, 在拒收之後讀標籤getter、呼叫 inspect.custom,
        //其副作用可改動呼叫端的find, 呼叫端把同一個find再送 delAll 即成無條件而刪全表(修前真 lowdb 實測刪 3/3 列)
        //不用 quiet(其以空函數取代 console.log, 不格式化引數而測不出): 以 util.format 格式化(同真 console.log)並收集輸出
        let logOrig = console.log
        let lines = []
        console.log = (...a) => {
            lines.push(util.format(...a))
        }
        let reads = 0
        let tagGetter = (f) => ({
            get() {
                reads++
                f()
                return 'Object'
            },
            configurable: true,
        })
        let cases = [
            ['原型帶標籤getter之真陣列於id.$in(getter刪除id條件)', () => {
                let a = ['a1']
                let find = { id: { $in: a } }
                Object.setPrototypeOf(a, Object.create(Array.prototype, { [Symbol.toStringTag]: tagGetter(() => delete find.id) }))
                return { find, intact: () => 'id' in find }
            }, msgIrreg],
            ['原型帶標籤getter之物件於$and元素(getter刪除$and)', () => {
                let find = { id: 'a1', $and: [] }
                find.$and.push(Object.create(Object.create(null, { [Symbol.toStringTag]: tagGetter(() => delete find.$and) })))
                return { find, intact: () => '$and' in find }
            }, msgIrreg],
            ['inspect.custom(自有Symbol鍵之函數)於頂層(函數刪除id條件)', () => {
                let find = { id: 'a1' }
                find[util.inspect.custom] = () => {
                    reads++
                    delete find.id
                    return 'x'
                }
                return { find, intact: () => 'id' in find }
            }, msgHidden],
            ['Proxy之目標帶標籤getter於$and元素(getter刪除$and)', () => {
                let find = { id: 'a1', $and: [] }
                find.$and.push(new Proxy(Object.defineProperty({}, Symbol.toStringTag, tagGetter(() => delete find.$and)), {}))
                return { find, intact: () => '$and' in find }
            }, msgIrreg],
            ['存取器屬性(對照: util.inspect 本不呼叫)', () => {
                let find = { id: 'a1' }
                Object.defineProperty(find, 'name', {
                    get() {
                        reads++
                        return 'x'
                    },
                    enumerable: true,
                })
                return { find, intact: () => 'id' in find }
            }, 'unsupported accessor property'],
        ]
        let done = 0
        try {
            for (let { kind, proc } of getKinds()) {
                for (let mode of ['select', 'delAll']) {
                    let other = mode === 'select' ? 'delAll' : 'select'
                    for (let [label, mk, msg] of cases) {
                        stub.reset()
                        lines.length = 0
                        let { find, intact } = mk()
                        let err = await getReject(proc('u1', 'tests', mode, find)).catch((e) => assert.fail(`${kind} ${mode} ${label} ${e.message}`))
                        assert.strictEqual(err, `invalid find of ${mode}, ${msg}`, `${kind} ${mode} ${label}`)
                        assert.strictEqual(reads, 0, `${kind} ${mode} ${label} 診斷輸出不得執行使用端程式`)
                        assert.ok(intact(), `${kind} ${mode} ${label} 使用端物件不被改動`)
                        assert.ok(lines.some((v) => v.includes('invalid find')), `${kind} ${mode} ${label} 仍輸出診斷`)
                        //同一物件再送另一動作: 仍同一原因reject, 不成為無條件
                        let err2 = await getReject(proc('u1', 'tests', other, find)).catch((e) => assert.fail(`${kind} ${other} ${label} 再送 ${e.message}`))
                        assert.strictEqual(err2, `invalid find of ${other}, ${msg}`, `${kind} ${other} ${label} 再送`)
                        assert.strictEqual(reads, 0, `${kind} ${other} ${label} 再送後仍0次`)
                        assert.ok(intact(), `${kind} ${other} ${label} 再送後使用端物件不被改動`)
                        assert.strictEqual(calls.length, 0, `${kind} ${mode} ${label} ORM不應被呼叫`)
                        done++
                    }
                }
            }
        }
        finally {
            console.log = logOrig
        }
        assert.strictEqual(cases.length, 5, '語料數')
        assert.strictEqual(done, 5 * 2 * 4, '完成數(語料 × 2 mode × 4 種資料表型態)')
    })

    it('D07b 被拒之find的診斷輸出為快照: 保留資料(字串、數字、巢狀)而不隨輸入放大, 大陣列、長字串、極深巢狀皆有上限且不拋錯', async function() {
        //R-OBJ-01 規則6 ⑤: 快照僅含本層新建之純資料; 值個數(含葉)200、層數8、每層50鍵或元素、字串200字元為上限
        let logOrig = console.log
        let lines = []
        console.log = (...a) => {
            lines.push(util.format(...a))
        }
        let deep = { v: 'bottom' }
        for (let i = 0; i < 60; i++) {
            deep = { n: deep }
        }
        let cases = [
            ['保留資料', () => ({ id: { $in: ['a1', 'a2'] }, name: 'alpha', [Symbol('s')]: 1 }), (t) => t.includes('a1') && t.includes('a2') && t.includes('alpha'), 2000],
            ['10萬元素之陣列', () => ({ id: { $in: Array.from({ length: 100000 }, (_, i) => `a${i}`) }, [Symbol('s')]: 1 }), (t) => t.includes('a0'), 5000],
            ['100萬字元之字串', () => ({ name: 'x'.repeat(1000000), [Symbol('s')]: 1 }), (t) => t.includes('xxxx'), 3000],
            ['60層巢狀', () => ({ $and: [deep], [Symbol('s')]: 1 }), (t) => t.includes('$and'), 3000],
            ['5萬個鍵', () => Object.assign(Object.fromEntries(Array.from({ length: 50000 }, (_, i) => [`k${i}`, i])), { [Symbol('s')]: 1 }), (t) => t.includes('k0'), 5000],
            //2000 個 200 字元之字串葉(40 鍵 x 50 元素): 值個數上限 200(含葉)使輸出不超過約 200 x 200 字元; 無上限時約 41 萬字元
            ['2000個字串葉', () => Object.assign(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, Array.from({ length: 50 }, () => 'y'.repeat(200))])), { [Symbol('s')]: 1 }), (t) => t.includes('yyyy'), 60000],
        ]
        let done = 0
        try {
            for (let { kind, proc } of getKinds()) {
                for (let mode of ['select', 'delAll']) {
                    for (let [label, mk, has, maxLen] of cases) {
                        stub.reset()
                        lines.length = 0
                        let err = await getReject(proc('u1', 'tests', mode, mk())).catch((e) => assert.fail(`${kind} ${mode} ${label} ${e.message}`))
                        assert.strictEqual(err, `invalid find of ${mode}, ${msgHidden}`, `${kind} ${mode} ${label}`)
                        let text = lines.join('\n')
                        assert.ok(has(text), `${kind} ${mode} ${label} 快照保留資料: ${text.slice(0, 200)}`)
                        assert.ok(text.length <= maxLen, `${kind} ${mode} ${label} 輸出長度 ${text.length} 應不超過 ${maxLen}`)
                        done++
                    }
                }
            }
        }
        finally {
            console.log = logOrig
        }
        assert.strictEqual(cases.length, 6, '語料數')
        assert.strictEqual(done, 6 * 2 * 4, '完成數(語料 × 2 mode × 4 種資料表型態)')
    })

    it('D08 品牌網的字元預算: 字串碼元總長逾4,000,000時不做結構化複製而改走精確探針(合法條件照常交ORM, WeakRef與FinalizationRegistry仍reject); 預算內仍做一次結構化複製', async function() {
        //R-OBJ-01 規則6 ⑥(sol 外審最終版 R3-02): structuredClone 對重複出現之字串每次皆寫出並讀回, 記憶體與(字串碼元總長 x 出現次數)成正比;
        //記憶體內僅一個64KB字串、於$in內重複1萬次即邏輯長度655M碼元(實測經本層峰值RSS 1.6GB, 直呼0.59GB); 觀察點為全域 structuredClone 之呼叫次數
        let orig = globalThis.structuredClone
        let nClone = 0
        let str = 'x'.repeat(65536)
        let big = (n) => Array(n).fill(str) //n x 65536 碼元: 40 -> 2.6M(預算內), 70 -> 4.6M(逾預算)
        let nul = (o) => Object.setPrototypeOf(o, null)
        let brands = [
            ['WeakRef', () => nul(new WeakRef({}))],
            ['FinalizationRegistry', () => nul(new FinalizationRegistry(() => {}))],
        ]
        let places = [
            ['較後鍵之$and元素', (n) => ({ name: { $in: big(70) }, $and: [n] })],
            ['id運算子位置', (n) => ({ name: { $in: big(70) }, id: n })],
            ['$or之較後兄弟', (n) => ({ $or: [{ name: { $in: big(70) } }, n] })],
        ]
        let done = 0
        try {
            for (let mode0 of ['spy', 'none']) {
                if (mode0 === 'spy') {
                    globalThis.structuredClone = (...a) => {
                        nClone++
                        return orig(...a)
                    }
                }
                else {
                    globalThis.structuredClone = undefined
                }
                for (let { kind, proc } of getKinds()) {
                    for (let mode of ['select', 'delAll']) {
                        let tag = `${mode0} ${kind} ${mode}`
                        //逾預算之合法條件: 照常交ORM, 實參等價; 有 structuredClone 時未被呼叫
                        stub.reset()
                        nClone = 0
                        let find = { name: { $in: big(70) }, id: { $in: ['a1'] } }
                        await proc('u1', 'tests', mode, find)
                        assert.strictEqual(calls.length, 1, `${tag} 逾預算之合法條件交ORM`)
                        assert.deepEqual(calls[0].data, find, `${tag} ORM收到`)
                        assert.strictEqual(nClone, 0, `${tag} 逾預算不做結構化複製`)
                        done++
                        //逾預算者含物件鍵(70 個物件各有一個 64KB 之同名鍵): 鍵之碼元亦計入
                        stub.reset()
                        nClone = 0
                        let longKey = 'k'.repeat(65536)
                        await proc('u1', 'tests', mode, { $and: Array.from({ length: 70 }, () => ({ [longKey]: 1 })) })
                        assert.strictEqual(calls.length, 1, `${tag} 逾預算之長鍵條件交ORM`)
                        assert.strictEqual(nClone, 0, `${tag} 鍵之碼元計入預算, 逾預算不做結構化複製`)
                        done++
                        //預算內: 仍做一次結構化複製(spy 模式)
                        if (mode0 === 'spy') {
                            stub.reset()
                            nClone = 0
                            await proc('u1', 'tests', mode, { name: { $in: big(40) } })
                            assert.strictEqual(calls.length, 1, `${tag} 預算內之合法條件交ORM`)
                            assert.strictEqual(nClone, 1, `${tag} 預算內做一次結構化複製`)
                            done++
                        }
                        //逾預算 + 品牌物件: 仍reject, 不做結構化複製, ORM未被呼叫
                        for (let [bl, mkBrand] of brands) {
                            for (let [pl, build] of places) {
                                stub.reset()
                                nClone = 0
                                let e = await quiet(() => getReject(proc('u1', 'tests', mode, build(mkBrand())))).catch((err) => assert.fail(`${tag} ${bl} ${pl} ${err.message}`))
                                assert.strictEqual(e, `invalid find of ${mode}, ${msgIrreg}`, `${tag} ${bl} ${pl}`)
                                assert.strictEqual(calls.length, 0, `${tag} ${bl} ${pl} ORM不應被呼叫`)
                                assert.strictEqual(nClone, 0, `${tag} ${bl} ${pl} 逾預算不做結構化複製`)
                                done++
                            }
                        }
                    }
                }
            }
        }
        finally {
            globalThis.structuredClone = orig
        }
        assert.strictEqual(typeof structuredClone, 'function', 'structuredClone 已還原')
        //spy: 4 表型態 x 2 mode x (逾預算合法 1 + 長鍵 1 + 預算內 1 + 品牌 2 x 3) = 72; none: 4 x 2 x (1 + 1 + 6) = 64
        assert.strictEqual(done, 72 + 64, '完成數')
    })

    it('D06 規則6不誤擋: null原型、跨realm、JSON與structuredClone產生者、含Date、大陣列與巢狀陣列之條件照常交ORM, 實參與送入者等價', async function() {
        //R-OBJ-01 規則6: 檢查只拒絕複本會洗掉之結構; JSON可表達之資料與合法特殊形狀須照常(含 structuredClone 品牌網不誤擋)
        let nul = (o) => Object.assign(Object.create(null), o)
        let cross = (src) => vm.runInNewContext(src)
        let d = new Date(0)
        let big = Array.from({ length: 10000 }, (_, i) => `a${i}`)
        let cases = [
            ['JSON.parse產生者', () => parse('{"$or":[{"id":"a1"},{"name":{"$in":["x","y"]}}],"length":{"$gte":1}}'), { $or: [{ id: 'a1' }, { name: { $in: ['x', 'y'] } }], length: { $gte: 1 } }],
            ['structuredClone產生者', () => structuredClone({ $and: [{ id: 'a1' }, { name: { $ne: 'x' } }] }), { $and: [{ id: 'a1' }, { name: { $ne: 'x' } }] }],
            ['跨realm之頂層純物件', () => cross('({ id: "a1", name: { $eq: "x" } })'), { id: 'a1', name: { $eq: 'x' } }],
            ['1萬個元素之$in', () => ({ id: { $in: big } }), { id: { $in: big } }],
            ['Date為欄位等值之值', () => ({ name: d }), { name: d }],
            ['null原型之$and元素', () => ({ $and: [nul({ id: 'a1' })] }), { $and: [{ id: 'a1' }] }],
            ['null原型之id運算子物件', () => ({ id: nul({ $in: ['a1', 'a2'] }) }), { id: { $in: ['a1', 'a2'] } }],
            ['null原型之非id欄位運算子物件', () => ({ name: nul({ $eq: 'x' }) }), { name: { $eq: 'x' } }],
            ['跨realm之巢狀物件與陣列', () => cross('({ $or: [{ id: "a1" }, { $and: [{ name: { $in: ["x", "y"] } }] }] })'), { $or: [{ id: 'a1' }, { $and: [{ name: { $in: ['x', 'y'] } }] }] }],
            ['Date為比較運算子之值', () => ({ name: { $gt: d } }), { name: { $gt: d } }],
            ['合理複雜之查詢', () => ({ $and: [{ $or: [{ id: { $in: ['a1', 'a2'] } }, { name: 'x' }] }, { length: { $gte: 1 } }] }), { $and: [{ $or: [{ id: { $in: ['a1', 'a2'] } }, { name: 'x' }] }, { length: { $gte: 1 } }] }],
            ['空陣列與空運算子集合', () => ({ id: { $in: [] }, $or: [] }), { id: { $in: [] }, $or: [] }],
        ]
        let done = 0
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let [label, mk, expected] of cases) {
                    stub.reset()
                    await proc('u1', 'tests', mode, mk())
                    assert.strictEqual(calls.length, 1, `${kind} ${mode} ${label}`)
                    //不比原型: 整數型主鍵表與無該表者原樣交ORM(null原型、跨realm), 轉型表為複本(本realm之Object.prototype)
                    assert.deepEqual(calls[0].data, expected, `${kind} ${mode} ${label} ORM收到`)
                    done++
                }
            }
        }
        assert.strictEqual(cases.length, 12, '語料數')
        assert.strictEqual(done, 12 * 2 * 4, '完成數(語料 × 2 mode × 4 種資料表型態)')
    })

})


describe('R-INPUT-01 規則5 woName須為woItems之自有字串屬性', function() {

    beforeEach(function() {
        stub.reset()
    })

    //各入口之最小有效輸入, 令未被woName檢查擋下者必然呼叫ORM
    let modes = [
        ['select', undefined],
        ['insert', [{ id: 'a' }]],
        ['save', [{ id: 'a' }]],
        ['del', [{ id: 'a' }]],
        ['delAll', undefined],
        ['mix', { add: [{ id: 'a' }] }],
    ]

    it('W01 woName為原型鏈上之名稱、路徑字串或非字串: 一律以固定字串reject, ORM未被呼叫', async function() {
        //R-INPUT-01 規則5、R-ERR-01 規則1: 原 lodash get 取到 Object.prototype 之成員或解析路徑(tests.select 取到 ORM 之函數), 以 TypeError 物件 reject
        let names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'tests.select', 'tests["select"]', 'tests.keys', 'tests.', 'Tests', 'nonexistent', '']
        let nonStrings = [1, ['tests'], { a: 1 }, null, undefined, true, Symbol('tests')]
        for (let { kind, proc } of getKinds()) {
            for (let [mode, input] of modes) {
                for (let name of names) {
                    let err = await quiet(() => getReject(proc('u1', name, mode, input)))
                    assert.strictEqual(err, `can not find table[${name}] in ORM`, `${kind} ${mode} ${name}`)
                }
                for (let name of nonStrings) {
                    let err = await quiet(() => getReject(proc('u1', name, mode, input)))
                    assert.strictEqual(err, 'can not find table[] in ORM', `${kind} ${mode} ${String(name)}`)
                }
            }
            assert.deepStrictEqual(calls, [], `${kind} ORM不應被呼叫`)
        }
    })

    it('W02 自有字串屬性照常: ds之鍵含「.」或為Object.prototype成員之名稱者亦然(不是名稱黑名單)', async function() {
        //R-INPUT-01 規則5: 判準是自有屬性, 不是名稱黑名單
        let ds = {
            'a.b': { keys: ['id', 'name'], settings: { id: { pk: true, type: 'STRING' }, name: { type: 'STRING' } } },
            'constructor': { keys: ['id', 'name'], settings: { id: { pk: true, type: 'STRING' }, name: { type: 'STRING' } } },
            'tests': dsStr.tests,
        }
        let so = WServOrm(ds, WOrmStub, 'u', 'd')
        for (let name of ['a.b', 'constructor', 'tests']) {
            stub.reset()
            let r = await so.procOrm('u1', name, 'insert', [{ id: 5, name: 'x' }])
            assert.deepStrictEqual(r, [{ id: '5' }], name)
            await so.procOrm('u1', name, 'select', { id: 5 })
            assert.deepStrictEqual(calls.map((c) => c.fn), ['insert', 'select'], name)
            same(calls[1].data, { id: '5' }, `${name} 轉型(isIdCast 取到該表之 ds)`)
        }
    })

})


describe('R-OBJ-01 規則5 find之巢狀深度上限', function() {

    beforeEach(function() {
        stub.reset()
    })

    //builders, 容器 = 一般物件與陣列
    //eqObj(n): n 個巢狀物件容器; andChain(n): n 層 $and(根物件 + 每層一個陣列與一個物件, 共 1+2n 個容器); notChain(n): { id: { $not: … } } 共 n+2 個容器(含根)
    //$not 為系列白名單外之鍵名(後端reject, 本套件castIdCond已不遞迴它, R-WL-01 規則3), 此處只作為 id 條件內之深層巢狀物件: 深度檢查與運算子名稱無關
    let eqObj = (n) => {
        let o = { k: 1 }
        for (let i = 1; i < n; i++) {
            o = { k: o }
        }
        return o
    }
    let andChain = (n) => {
        let o = { id: 1 }
        for (let i = 0; i < n; i++) {
            o = { $and: [o] }
        }
        return o
    }
    let notChain = (n) => {
        let c = { $eq: 1 }
        for (let i = 0; i < n; i++) {
            c = { $not: c }
        }
        return { id: c }
    }
    //findDepth(d): 恰 d 個容器層之 find(d>=2)
    let findDepth = (d) => ({ name: eqObj(d - 1) })

    it('T01 find之容器層數超過64即以固定字串reject, 64層以內照常; 深層巢狀不再以RangeError物件reject', async function() {
        //R-OBJ-01 規則5、R-ERR-01 規則1: 修前字串型主鍵表約1173層$and、約1857層$not鏈起以RangeError物件reject, 其餘表型態原樣交後端
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                //邊界: 64 層照常、65 層 reject
                for (let [label, find, ok] of [
                    ['eq 64', findDepth(64), true],
                    ['eq 65', findDepth(65), false],
                    ['$and 31層(63容器)', andChain(31), true],
                    ['$and 32層(65容器)', andChain(32), false],
                    ['$not 鏈 62(64容器)', notChain(62), true],
                    ['$not 鏈 63(65容器)', notChain(63), false],
                ]) {
                    stub.reset()
                    if (ok) {
                        await proc('u1', 'tests', mode, find)
                        assert.strictEqual(calls.length, 1, `${kind} ${mode} ${label} 應交ORM`)
                    }
                    else {
                        let err = await quiet(() => getReject(proc('u1', 'tests', mode, find)))
                        assert.strictEqual(err, `invalid find of ${mode}, too deep`, `${kind} ${mode} ${label}`)
                        assert.strictEqual(calls.length, 0, `${kind} ${mode} ${label} ORM不應被呼叫`)
                    }
                }
                //極深: 皆為固定字串(typeof string), 不洩漏 RangeError 物件
                stub.reset()
                for (let [label, find] of [['$and 1e4', andChain(1e4)], ['$not 1e4', notChain(1e4)], ['eq 1e5', findDepth(1e5)], ['$and 1e5', andChain(1e5)]]) {
                    let err = await quiet(() => getReject(proc('u1', 'tests', mode, find)))
                    assert.strictEqual(err, `invalid find of ${mode}, too deep`, `${kind} ${mode} ${label}`)
                }
                assert.strictEqual(calls.length, 0, `${kind} ${mode} ORM不應被呼叫`)
            }
        }
    })

    it('T02 合理之複雜查詢照常; 寫入列之深層巢狀由adjustData轉為固定字串(行為鎖定, 不設上限)', async function() {
        //R-OBJ-01 規則5: 合理查詢最深約7個容器; 列之遞迴由wsemi clearXSS進行, 約1e4層起拋RangeError, 被adjustData之try/catch轉為 failed to adjust data
        let find = { $or: [{ id: { $in: [1, 2] } }, { $and: [{ name: 'x' }, { $or: [{ name: 'y' }, { id: { $ne: 3 } }] }] }] }
        //手寫之預期(不取自被測函式): 字串型與未知型主鍵表之最深一層 id 條件亦須轉為字串(R-WL-01 規則3: 遞迴 $and、$or 至任何層), 整數型與無該表者原樣
        let expectCast = { $or: [{ id: { $in: ['1', '2'] } }, { $and: [{ name: 'x' }, { $or: [{ name: 'y' }, { id: { $ne: '3' } }] }] }] }
        for (let { kind, cast, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                stub.reset()
                await proc('u1', 'tests', mode, find)
                assert.strictEqual(calls.length, 1, `${kind} ${mode}`)
                same(calls[0].data, cast ? expectCast : find, `${kind} ${mode} ORM收到`)
            }
        }
        let row = (n) => ({ id: 'r1', meta: eqObj(n) })
        let arr = (n) => {
            let a = []
            for (let i = 0; i < n; i++) {
                a = [a]
            }
            return { id: 'r1', meta: a }
        }
        for (let { kind, proc } of getKinds()) {
            if (kind === 'none') {
                continue
            }
            stub.reset()
            //深層列之結果依wsemi之遞迴與呼叫堆疊而定(預設堆疊: 以固定字串 failed to adjust data reject; 加大堆疊: 可能交給後端而resolve),
            //故只斷言「不以Error物件reject」, 不鎖定哪一種(外審 opus 二輪 F11)
            let outcome = (mode, input) => quiet(() => proc('u1', 'tests', mode, input)).then(() => 'resolved', (e) => e)
            for (let n of [1e4, 1e5]) {
                for (let [label, mode, input] of [['insert', 'insert', [row(n)]], ['save', 'save', arr(n)], ['mix.add', 'mix', { add: [row(n)] }], ['mix.diff', 'mix', { diff: [arr(n)] }]]) {
                    let r = await outcome(mode, input)
                    assert.ok(r === 'resolved' || typeof r === 'string', `${kind} ${label} ${n}: ${r instanceof Error ? r.constructor.name : typeof r}`)
                }
            }
        }
    })

})


describe('R-ERR-01 規則5 邊界保證: mapOrm 之非字串例外一律轉為固定字串', function() {

    beforeEach(function() {
        stub.reset()
    })

    let FIXED = 'failed to process input'

    it('C01 mode為物件、Symbol或null原型物件: 以固定字串reject(原 invalid mode 之字串轉換拋TypeError)', async function() {
        //R-ERR-01 規則5(外審 opus 二輪 F8): 與T5同類, 使用端值直接進模板字串
        for (let { kind, proc } of getKinds()) {
            for (let mode of [parse('{"toString":1}'), Symbol('x'), Object.create(null)]) {
                let err = await quiet(() => getReject(proc('u1', 'tests', mode, {})))
                assert.strictEqual(err, FIXED, `${kind} ${String(typeof mode)}`)
            }
            //對照: 可轉字串者維持既有之 invalid mode 訊息
            assert.strictEqual(await quiet(() => getReject(proc('u1', 'tests', 'nope', {}))), 'invalid mode: nope', kind)
        }
        assert.deepStrictEqual(calls, [], 'ORM不應被呼叫')
    })

    it('C02 寫入列為已撤銷之Proxy或get陷阱拋錯之Proxy: 以固定字串reject, 不轉出拋出之值', async function() {
        //R-ERR-01 規則5(外審 opus 二輪 F3): isobj 讀 Symbol.toStringTag 即拋錯, 在 getReasonBadKey 之 try 之外
        let revoked = Proxy.revocable({ id: 'x' }, {})
        revoked.revoke()
        let mkTrap = () => new Proxy({ id: 'x' }, {
            get() {
                throw new Error('SECRET-TRAP')
            },
        })
        for (let { kind, proc } of getKinds()) {
            if (kind === 'none') {
                continue
            }
            let rj = (mode, input) => quiet(() => getReject(proc('u1', 'tests', mode, input)))
            for (let mk of [() => revoked.proxy, mkTrap]) {
                assert.strictEqual(await rj('insert', [mk()]), FIXED, `${kind} insert`)
                assert.strictEqual(await rj('insert', mk()), FIXED, `${kind} insert 單一`)
                assert.strictEqual(await rj('save', [mk()]), FIXED, `${kind} save`)
                assert.strictEqual(await rj('mix', { add: [mk()] }), FIXED, `${kind} mix.add`)
                assert.strictEqual(await rj('mix', { diff: [mk()] }), FIXED, `${kind} mix.diff`)
            }
        }
        assert.deepStrictEqual(calls, [], 'ORM不應被呼叫')
    })

    it('C03 被拒之find帶util.inspect.custom拋錯: 仍回特定之固定訊息(console.log 不得使 reject 變成例外物件)', async function() {
        //R-ERR-01 規則5(外審 opus 二輪 F7): console.log 原 input 時呼叫使用端之 inspect.custom
        //不用 quiet(其以空函數取代 console.log, 不會格式化引數而測不出): 改以 util.format 格式化引數(同真 console.log)後丟棄
        let logOrig = console.log
        console.log = (...a) => {
            util.format(...a)
        }
        try {
            for (let { kind, proc } of getKinds()) {
                for (let mode of ['select', 'delAll']) {
                    let f = parse('{"__proto__":1}')
                    f[Symbol.for('nodejs.util.inspect.custom')] = () => {
                        throw new Error('SECRET-INSPECT')
                    }
                    let err = await getReject(proc('u1', 'tests', mode, f))
                    assert.strictEqual(err, `invalid find of ${mode}, unsupported key[__proto__]`, `${kind} ${mode}`)
                }
            }
        }
        finally {
            console.log = logOrig
        }
    })

    it('C04 循環或鏈狀共用子結構之find使遞迴爆堆疊: 以固定字串reject(循環: 字串型主鍵表, 其餘表型態原樣交ORM; 鏈狀共用: 所有表型態皆由規則6之品牌網reject)', async function() {
        //R-ERR-01 規則5、R-OBJ-01 已知限制(外審 opus 二輪 F4): 深度檢查不涵蓋共用子結構, 由邊界保證兜底
        let cyc = { $and: [] }
        cyc.$and.push(cyc)
        let shared = { id: 1 }
        let chain = []
        for (let i = 0; i < 5000; i++) {
            shared = { $and: [shared] }
            chain.push(shared)
        }
        //由短到長依序被 getReasonBadKey 彈出(堆疊後進先出, 故陣列內長者排前): 每個 $and 節點皆經根之 $or 以第 3 層先被走到, 檢查所見最大深度僅 5, 實際最長路徑約 1e4 個容器
        let dag = { $or: [...chain].reverse() }
        for (let { kind, cast, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let [label, find] of [['循環', cyc], ['鏈狀共用', dag]]) {
                    stub.reset()
                    if (label === '鏈狀共用') {
                        //規則6: 最長路徑約1e4個容器, 遠超結構化複製之遞迴上限(Node 24.19.0 實測約1576個容器, 與冷熱無關), 品牌網於複製前即以固定字串reject, 所有資料表型態皆然
                        let err = await quiet(() => getReject(proc('u1', 'tests', mode, find)))
                        assert.strictEqual(err, `invalid find of ${mode}, unsupported irregular object or array`, `${kind} ${mode} ${label}`)
                        assert.strictEqual(calls.length, 0, `${kind} ${mode} ${label} ORM不應被呼叫`)
                    }
                    else if (cast) {
                        let err = await quiet(() => getReject(proc('u1', 'tests', mode, find)))
                        assert.strictEqual(err, FIXED, `${kind} ${mode} ${label}`)
                        assert.strictEqual(calls.length, 0, `${kind} ${mode} ${label} ORM不應被呼叫`)
                    }
                    else {
                        await proc('u1', 'tests', mode, find)
                        assert.strictEqual(calls.length, 1, `${kind} ${mode} ${label} 原樣交ORM`)
                    }
                }
            }
        }
    })

    it('C05 woItems 之值非 ORM(行程內被改)者: 以固定字串reject', async function() {
        //R-ERR-01 規則5(外審 opus 二輪 F10b): getOwnItem 只排除 null/undefined, 其後 wo.select is not a function 原以 TypeError 物件 reject
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        so.woItems.bad0 = 0
        so.woItems.bad1 = {}
        for (let name of ['bad0', 'bad1']) {
            for (let [mode, input] of [['select', {}], ['delAll', {}], ['del', [{ id: 'a' }]]]) {
                let err = await quiet(() => getReject(so.procOrm('u1', name, mode, input)))
                assert.strictEqual(err, FIXED, `${name} ${mode}`)
            }
            //insert 於 ORM 呼叫前先經 adjustData(ds 無該表而拋錯), 由其 try/catch 轉為既有之固定字串
            assert.strictEqual(await quiet(() => getReject(so.procOrm('u1', name, 'insert', [{ id: 'a' }]))), 'failed to adjust data', `${name} insert`)
        }
    })

})


describe('R-INPUT-01 規則5 getWoItems 以自有屬性建表', function() {

    beforeEach(function() {
        stub.reset()
    })

    it('W03 ds之鍵為__proto__(JSON載入之schema): 該表為woItems之自有屬性且可用, woItems之原型不被改設', async function() {
        //R-INPUT-01 規則5、R-OBJ-01 規則2(外審 opus 二輪 F10a): 原 woItems[v]=wo 改設 woItems 之原型, 該表永遠 can not find table
        let ds = JSON.parse('{"__proto__":{"keys":["id","name"],"settings":{"id":{"pk":true,"type":"STRING"}}},"tests":{"keys":["id","name"],"settings":{"id":{"pk":true,"type":"STRING"}}}}')
        let so = WServOrm(ds, WOrmStub, 'u', 'd')
        assert.strictEqual(Object.getPrototypeOf(so.woItems), Object.prototype)
        assert.deepStrictEqual(Object.keys(so.woItems).sort(), ['__proto__', 'tests'])
        await so.procOrm('u1', '__proto__', 'select', { name: 'x' })
        await so.procOrm('u1', 'tests', 'select', { name: 'x' })
        assert.strictEqual(calls.length, 2)
    })

})
