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
            //規則7 ②(第82項)起寫入列頂層之Proxy一律 irregular reject 且不觸發任何陷阱(原 unreadable value, 陷阱被執行後才拋錯); 以 reads 斷言陷阱0次
            ['ownKeys陷阱拋錯', () => new Proxy({ id: 'a' }, {
                ownKeys() {
                    reads++
                    throw new Error('SECRET-TRAP')
                }
            }), 'unsupported irregular object or array'],
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

    it('C02 寫入列為已撤銷之Proxy或get陷阱拋錯之Proxy: 以固定字串reject, 不轉出拋出之值, 陷阱不被執行', async function() {
        //R-ERR-01 規則5(外審 opus 二輪 F3): isobj 讀 Symbol.toStringTag 即拋錯, 在 getReasonBadKey 之 try 之外
        //規則7 ②(第82項)起: 頂層列為Proxy(含已撤銷者)以 types.isProxy 判斷(不觸發陷阱), 一律 irregular reject(原為邊界保證之 failed to process input, 且 get 陷阱先被執行而拋錯)
        let trapReads = 0
        let revoked = Proxy.revocable({ id: 'x' }, {})
        revoked.revoke()
        let mkTrap = () => new Proxy({ id: 'x' }, {
            get() {
                trapReads++
                throw new Error('SECRET-TRAP')
            },
        })
        let IRREG = 'unsupported irregular object or array'
        for (let { kind, proc } of getKinds()) {
            if (kind === 'none') {
                continue
            }
            let rj = (mode, input) => quiet(() => getReject(proc('u1', 'tests', mode, input)))
            //單一輸入為已撤銷之Proxy時無法分類為陣列或單一列(Array.isArray拋TypeError), 於讀取與ORM呼叫之前以容器層之固定訊息拒收(無位置); 未撤銷者仍為列層之 data[0]
            for (let [mk, single] of [[() => revoked.proxy, `failed to insert data, ${IRREG}`], [mkTrap, `failed to insert data, ${IRREG}: data[0]`]]) {
                assert.strictEqual(await rj('insert', [mk()]), `failed to insert data, ${IRREG}: data[0]`, `${kind} insert`)
                assert.strictEqual(await rj('insert', mk()), single, `${kind} insert 單一`)
                assert.strictEqual(await rj('save', [mk()]), `failed to save data, ${IRREG}: data[0]`, `${kind} save`)
                assert.strictEqual(await rj('mix', { add: [mk()] }), `failed to insert data, ${IRREG}: data[0]`, `${kind} mix.add`)
                assert.strictEqual(await rj('mix', { diff: [mk()] }), `failed to update data, ${IRREG}: data[0]`, `${kind} mix.diff`)
            }
        }
        assert.strictEqual(trapReads, 0, '陷阱不應被執行')
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

    it('C04 循環或鏈狀共用子結構之find(原使遞迴爆堆疊): 所有表型態皆以固定字串 too deep reject, ORM未被呼叫', async function() {
        //R-ERR-01 規則5、R-OBJ-01 規則5續(第82項): 原深度檢查不涵蓋共用子結構, 循環於字串型主鍵表由邊界保證轉為 failed to process input、其餘表型態原樣交ORM,
        //鏈狀共用由規則6之品牌網以 irregular reject; 現由 measureFind 於所有表型態判定最長路徑(含循環), 預期隨之更新(只改訊息預期與循環之非字串型表, 不放寬)
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
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                for (let [label, find] of [['循環', cyc], ['鏈狀共用', dag]]) {
                    stub.reset()
                    //最長路徑約1e4個容器(鏈狀共用)或無限(循環), 皆超過64個容器層: measureFind 於結構化複製與castIdFind之前以固定字串reject, 所有資料表型態皆然
                    let err = await quiet(() => getReject(proc('u1', 'tests', mode, find)))
                    assert.strictEqual(err, `invalid find of ${mode}, too deep`, `${kind} ${mode} ${label}`)
                    assert.strictEqual(calls.length, 0, `${kind} ${mode} ${label} ORM不應被呼叫`)
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


//R-OBJ-01 規則7(第82項, Argon 外審第三輪 B-02 與核實時另發現之 F5、F6): 寫入列與批次容器——檢查之值即使用之值, 且不執行使用端程式
//預言機為手寫預期(依規則7各句), 不取自被測函式之回傳; 僅替身ORM(接真ORM見 api-objcopy A27、A28)
describe('R-OBJ-01 規則7 寫入列之id只認自有可列舉資料屬性、頂層列之乾淨判準(S01、S02)', function() {

    beforeEach(function() {
        stub.reset()
    })

    let hide = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true })
    let KINDS = ['str', 'unknown', 'int'] //寫入與del之路徑不含 none(ds無該表, 寫入於adjustData拋錯)
    let ENTRIES = ['insert', 'save', 'mix.add', 'mix.diff', 'del', 'mix.del']
    let msgWrite = { 'insert': 'failed to insert data', 'save': 'failed to save data', 'mix.add': 'failed to insert data', 'mix.diff': 'failed to update data' }
    let run = (proc, entry, row) => {
        switch (entry) {
        case 'insert': return proc('u1', 'tests', 'insert', [row])
        case 'save': return proc('u1', 'tests', 'save', [row])
        case 'mix.add': return proc('u1', 'tests', 'mix', { add: [row] })
        case 'mix.diff': return proc('u1', 'tests', 'mix', { diff: [row] })
        case 'del': return proc('u1', 'tests', 'del', [row])
        case 'mix.del': return proc('u1', 'tests', 'mix', { del: [row] })
        }
        throw new Error(`entry ${entry}`)
    }
    let firstRow = () => {
        let d = calls[0].data
        return Array.isArray(d) ? d[0] : d
    }
    let hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

    //id形態表: w=寫入列(insert、save、mix.add、mix.diff), d=del, md=mix.del 之預期
    //  w: 'keep'=ORM收到之自有id同送入者; 'cast'=字串型/未知型表轉為字串(整數型表原數字); 'gen'=視為未提供(字串型/未知型表補主鍵, 整數型表無自有id); 'rej:<原因>'=整批reject
    //  d: 'ref'=ORM收到之列即送入之同一物件(本層不轉型亦不複製); 'cast'=字串型/未知型表複製並轉為字串, 整數型表同ref; null=不測(Proxy之del列交後端, 屬既有)
    //  md: 'ok'=通過且本層不轉型(同d之'ref'); 'cast'=通過且字串型/未知型表轉字串(同d之'cast'); 'rej'=整批reject
    let forms = () => [
        { k: 'F01', label: '自有可列舉字串id', mk: () => ({ row: { id: 'a1', name: 'x' } }), w: 'keep', d: 'ref', md: 'ok' },
        { k: 'F02', label: '自有可列舉有限數字id', mk: () => ({ row: { id: 123, name: 'x' } }), w: 'cast', d: 'cast', md: 'cast' },
        { k: 'F04', label: '自有不可列舉字串id', mk: () => ({ row: hide({ name: 'x' }, 'id', 'a1') }), w: 'gen', d: 'ref', md: 'rej' },
        { k: 'F05', label: '自有不可列舉數字id(修前被「復活」為可列舉字串id)', mk: () => ({ row: hide({ name: 'x' }, 'id', 123) }), w: 'gen', d: 'ref', md: 'rej' },
        { k: 'F06', label: '繼承字串id(Object.create)', mk: () => ({ row: Object.assign(Object.create({ id: 'a1' }), { name: 'x' }) }), w: 'gen', d: 'ref', md: 'rej' },
        { k: 'F07', label: '繼承數字id(修前被「復活」為可列舉字串id)', mk: () => ({ row: Object.assign(Object.create({ id: 123 }), { name: 'x' }) }), w: 'gen', d: 'ref', md: 'rej' },
        {
            k: 'F08',
            label: '自有可列舉存取器id',
            mk: () => {
                let c = { n: 0 }
                let row = { name: 'x' }
                Object.defineProperty(row, 'id', {
                    enumerable: true,
                    get() {
                        c.n++; return 'a1'
                    }
                })
                return { row, c }
            },
            w: 'rej:unsupported accessor property',
            d: 'ref',
            md: 'rej'
        },
        {
            k: 'F09',
            label: '自有不可列舉存取器id',
            mk: () => {
                let c = { n: 0 }
                let row = { name: 'x' }
                Object.defineProperty(row, 'id', {
                    enumerable: false,
                    get() {
                        c.n++; return 'a1'
                    }
                })
                return { row, c }
            },
            w: 'gen',
            d: 'ref',
            md: 'rej'
        },
        {
            k: 'F10',
            label: '繼承存取器id(類別getter)',
            mk: () => {
                let c = { n: 0 }
                class R {
                    constructor() {
                        this.name = 'x'
                    }

                    get id() {
                        c.n++; return 'a1'
                    }
                }
                return { row: new R(), c }
            },
            w: 'gen',
            d: 'ref',
            md: 'rej'
        },
        { k: 'F11', label: 'null原型列、自有id', mk: () => ({ row: Object.assign(Object.create(null), { id: 'a1', name: 'x' }) }), w: 'keep', d: 'ref', md: 'ok' },
        {
            k: 'F12',
            label: 'Proxy列(計數陷阱)',
            mk: () => {
                let c = { n: 0 }
                let row = new Proxy({ id: 'a1', name: 'x' }, {
                    get(t, k, r) {
                        c.n++; return Reflect.get(t, k, r)
                    },
                    getOwnPropertyDescriptor(t, k) {
                        c.n++; return Reflect.getOwnPropertyDescriptor(t, k)
                    },
                    ownKeys(t) {
                        c.n++; return Reflect.ownKeys(t)
                    },
                    has(t, k) {
                        c.n++; return Reflect.has(t, k)
                    },
                })
                return { row, c }
            },
            w: 'rej:unsupported irregular object or array',
            d: null,
            md: 'rej'
        },
        { k: 'F13', label: 'null原型之Map(品牌物件, 無標籤可辨)', mk: () => ({ row: Object.setPrototypeOf(new Map([['id', 'a1']]), null) }), w: 'rej:unsupported irregular object or array', d: 'ref', md: 'ok' },
        { k: 'F14', label: '列自有Symbol.toStringTag', mk: () => ({ row: { id: 'a1', name: 'x', [Symbol.toStringTag]: 'X' } }), w: 'rej:unsupported irregular object or array', d: 'ref', md: 'rej' },
    ]

    it('S01 列之id形態 x 六個入口 x 三種資料表型態: id只認自有可列舉資料屬性, getter與陷阱0次, 不改呼叫端物件(B-02 ①②④、F6)', async function() {
        //規則7 ①②; R-ID-02 規則4續; R-MIX-01 規則6
        let done = 0
        let fs0 = forms()
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            let cast = kind !== 'int'
            for (let f of fs0) {
                for (let entry of ENTRIES) {
                    stub.reset()
                    let { row, c } = f.mk()
                    let label = `${kind} ${f.k}(${f.label}) ${entry}`
                    let isW = entry.startsWith('insert') || entry === 'save' || entry.startsWith('mix.a') || entry === 'mix.diff'
                    let exp = isW ? f.w : entry === 'del' ? f.d : f.md
                    if (exp === null) {
                        continue //Proxy之del列交後端(R-INPUT-01 規則2), 屬既有行為, 不測
                    }
                    let before = Reflect.ownKeys(row).length
                    if (c) {
                        c.n = 0 //上一行對Proxy取ownKeys是測試自己的讀取, 不計入
                    }
                    if (typeof exp === 'string' && exp.startsWith('rej')) {
                        let msg = isW ? `${msgWrite[entry]}, ${exp.slice(4)}: data[0]` : exp === 'rej' ? 'failed to delete data, unsupported irregular object or array: data[0]' : null
                        let err = await quiet(() => getReject(run(proc, entry, row)))
                        assert.strictEqual(err, msg, label)
                        assert.deepStrictEqual(calls, [], `${label} ORM不應被呼叫`)
                    }
                    else {
                        await quiet(() => run(proc, entry, row))
                        assert.strictEqual(calls.length, 1, `${label} ORM被呼叫一次`)
                        let got = firstRow()
                        if (isW) {
                            let want = { keep: 'a1', cast: cast ? '123' : 123 }[exp]
                            if (exp === 'gen') {
                                if (cast) {
                                    assert.ok(isGen(got.id), `${label} 補主鍵, 實收 ${String(got.id)}`)
                                }
                                else {
                                    assert.ok(!hasOwn(got, 'id'), `${label} 整數型主鍵表不補值`)
                                }
                            }
                            else {
                                assert.strictEqual(got.id, want, `${label} id`)
                            }
                            assert.strictEqual(Object.getPrototypeOf(got), Object.prototype, `${label} 寫入複本為一般物件`)
                            assert.ok(got !== row, `${label} 寫入複本非呼叫端物件`)
                            assert.strictEqual(got.name, 'x', `${label} 他欄不變`)
                        }
                        else if (exp === 'cast' && cast) {
                            assert.ok(got !== row, `${label} 複製`)
                            assert.strictEqual(got.id, '123', `${label} 轉字串`)
                            assert.strictEqual(row.id, 123, `${label} 不改呼叫端物件`)
                        }
                        else {
                            assert.ok(got === row, `${label} 本層不轉型亦不複製(同一參考)`)
                        }
                    }
                    if (c) {
                        assert.strictEqual(c.n, 0, `${label} getter/陷阱次數`)
                    }
                    assert.strictEqual(Reflect.ownKeys(row).length, before, `${label} 不改呼叫端物件`)
                    done++
                }
            }
        }
        assert.strictEqual(done, 3 * (13 * 6 - 1), '完成數(3表型態 x 13形態 x 6入口, 扣掉Proxy之del列)')
    })

    it('S01b 存取器id於檢查通過後才被執行並向列加入含自有__proto__之欄位(B-02 ②原重現): getter不被執行, 該欄位不被寫入', async function() {
        //規則7 ①②; 修前: 字串型表getter被執行2次(mix 3次)、整數型表1次(mix 2次), 列內meta含自有__proto__被送到ORM
        let mkOwn = (c) => {
            let r = { name: 'n3' }
            Object.defineProperty(r, 'id', {
                enumerable: false,
                get() {
                    c.n++; r.meta = parse('{"__proto__":{"polluted":1}}'); return 'a3'
                }
            })
            return r
        }
        let mkInherited = (c) => {
            class R {
                constructor() {
                    this.name = 'n3'
                }

                get id() {
                    c.n++; this.meta = parse('{"__proto__":{"polluted":1}}'); return 'a3'
                }
            }
            return new R()
        }
        let done = 0
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            for (let [lab, mk] of [['自有不可列舉getter', mkOwn], ['繼承getter', mkInherited]]) {
                for (let entry of ['insert', 'save', 'mix.add', 'mix.diff']) {
                    stub.reset()
                    let c = { n: 0 }
                    let row = mk(c)
                    await quiet(() => run(proc, entry, row))
                    assert.strictEqual(c.n, 0, `${kind} ${lab} ${entry} getter不被執行`)
                    assert.strictEqual(calls.length, 1, `${kind} ${lab} ${entry}`)
                    assert.ok(!hasOwn(firstRow(), 'meta'), `${kind} ${lab} ${entry} getter內加入之欄位不被寫入`)
                    done++
                }
            }
        }
        assert.strictEqual(done, 3 * 2 * 4, '完成數')
    })

    it('S02 頂層列為Proxy、帶標籤、內建品牌物件(原型改為null): 整批reject並列位置, 陷阱0次, 與其他原因分組; 類別實例DTO、Object.create、跨realm、null原型之列照收(Q1(a))', async function() {
        //規則7 ②及其與find(strict)之差異; 修前: null原型之Map等通過並被mapOwn洗成{}而寫入垃圾列, Proxy列之陷阱被執行14~17次
        let nul = (o) => Object.setPrototypeOf(o, null)
        let c = { n: 0 }
        let mkProxy = () => new Proxy({ id: 'p', name: 'x' }, {
            get(t, k, r) {
                c.n++; return Reflect.get(t, k, r)
            },
            getOwnPropertyDescriptor(t, k) {
                c.n++; return Reflect.getOwnPropertyDescriptor(t, k)
            },
            ownKeys(t) {
                c.n++; return Reflect.ownKeys(t)
            },
            has(t, k) {
                c.n++; return Reflect.has(t, k)
            },
            getPrototypeOf(t) {
                c.n++; return Reflect.getPrototypeOf(t)
            },
        })
        let bads = [
            ['Proxy', mkProxy],
            ['自有標籤', () => ({ id: 'p', [Symbol.toStringTag]: 'X' })],
            ['原型上之標籤', () => Object.assign(Object.create(Object.assign(Object.create(null), { [Symbol.toStringTag]: 'X' })), { id: 'p' })],
            ['Map(null原型)', () => nul(new Map([['id', 'p']]))],
            ['Set(null原型)', () => nul(new Set([1]))],
            ['WeakMap(null原型)', () => nul(new WeakMap())],
            ['Promise(null原型)', () => nul(Promise.resolve(1))],
            ['ArrayBuffer(null原型)', () => nul(new ArrayBuffer(2))],
            ['DataView(null原型)', () => nul(new DataView(new ArrayBuffer(2)))],
            ['Uint8Array(null原型)', () => nul(new Uint8Array(2))],
        ]
        let done = 0
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            for (let [lab, mk] of bads) {
                let L = `${kind} ${lab}`
                let rj = (mode, input) => quiet(() => getReject(proc('u1', 'tests', mode, input)))
                for (let [mode, mk2, msg] of [
                    ['insert', (r) => [r], 'failed to insert data'],
                    ['save', (r) => [r], 'failed to save data'],
                    ['insert', (r) => r, 'failed to insert data'], //單一物件輸入
                    ['mix', (r) => ({ add: [r] }), 'failed to insert data'],
                    ['mix', (r) => ({ diff: [{ id: 'ok' }, r] }), 'failed to update data'],
                ]) {
                    stub.reset()
                    c.n = 0
                    let idx = mode === 'mix' && msg === 'failed to update data' ? 1 : 0
                    assert.strictEqual(await rj(mode, mk2(mk())), `${msg}, unsupported irregular object or array: data[${idx}]`, `${L} ${mode} ${msg}`)
                    assert.strictEqual(c.n, 0, `${L} 陷阱次數`)
                    assert.deepStrictEqual(calls, [], `${L} ORM不應被呼叫`)
                    done++
                }
                //多筆批次中之第2筆, 與其他原因分組(依首次出現之順序)
                assert.strictEqual(await rj('insert', [{ id: 'ok' }, mk()]), 'failed to insert data, unsupported irregular object or array: data[1]', `${L} 第2筆`)
                assert.strictEqual(await rj('insert', [mk(), parse('{"id":"q","__proto__":1}')]),
                    'failed to insert data, unsupported irregular object or array: data[0]; failed to insert data, unsupported key[__proto__]: data[1]', `${L} 分組`)
                done++
            }
        }
        assert.strictEqual(done, 3 * 10 * 6, '完成數')

        //差異(Q1(a)): 這些列照收, ORM收到自有可列舉鍵之複本(mapOwn), 與直呼後端一致
        class Dto {
            constructor() {
                this.id = 'c1'
                this.name = 'n'
            }

            method() {}
        }
        let vmObj = vm.runInNewContext('({ id: "v1", name: "n" })')
        let accepts = [
            ['類別實例DTO(含自有欄位)', () => new Dto(), { id: 'c1', name: 'n' }],
            ['Object.create(proto)含自有欄位', () => Object.assign(Object.create({ inherited: 1 }), { id: 'o1', name: 'n' }), { id: 'o1', name: 'n' }],
            ['跨realm(vm)之列', () => vmObj, { id: 'v1', name: 'n' }],
            ['null原型之列', () => Object.assign(Object.create(null), { id: 'u1', name: 'n' }), { id: 'u1', name: 'n' }],
            ['含Symbol鍵與不可列舉鍵之列(後端亦略過)', () => hide(Object.assign({ id: 's1', name: 'n' }, { [Symbol('s')]: 1 }), 'hid', 1), { id: 's1', name: 'n' }],
        ]
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            for (let [lab, mk, expected] of accepts) {
                stub.reset()
                await quiet(() => proc('u1', 'tests', 'insert', [mk()]))
                assert.strictEqual(calls.length, 1, `${kind} ${lab}`)
                let got = firstRow()
                assert.deepStrictEqual(Object.keys(got).sort(), Object.keys(expected).sort(), `${kind} ${lab} 鍵`)
                assert.strictEqual(got.id, expected.id, `${kind} ${lab} id`)
                assert.strictEqual(Object.getPrototypeOf(got), Object.prototype, `${kind} ${lab} 複本為本realm一般物件`)
            }
        }
    })

})


describe('R-OBJ-01 規則7 批次容器(S03、S04)', function() {

    beforeEach(function() {
        stub.reset()
    })

    let KINDS = ['str', 'unknown', 'int']
    let evil = () => parse('{"id":"zz","name":"e","meta":{"__proto__":{"polluted":1}}}') //列內含巢狀自有__proto__: 規則3須擋下
    let okRow = () => ({ id: 'a1', name: 'x' })
    let sp = (n) => new Array(n)
    let rj = (proc, mode, input) => quiet(() => getReject(proc('u1', 'tests', mode, input)))
    let elapsed = async (fn) => {
        let t = Date.now()
        let r = await fn()
        return [r, Date.now() - t]
    }

    it('S03 批次容器為偽造標籤之類陣列、Proxy陣列、有空洞(含原型帶資料索引)、原型鏈有標籤: 整批reject, 繞過規則3之列不被寫入, length與陷阱0次(F5)', async function() {
        //規則7 ③④; R-INPUT-01 規則1、2(批次容器); 修前: 偽造標籤與空洞+繼承索引兩形狀使含巢狀自有__proto__之列通過getMsgsBadKey並被送到ORM
        let reads = 0
        let counted = (target) => new Proxy(target, {
            get(t, k, r) {
                reads++; return Reflect.get(t, k, r)
            },
            has(t, k) {
                reads++; return Reflect.has(t, k)
            },
            ownKeys(t) {
                reads++; return Reflect.ownKeys(t)
            },
            getOwnPropertyDescriptor(t, k) {
                reads++; return Reflect.getOwnPropertyDescriptor(t, k)
            },
        })
        let fakeTag = () => ({
            [Symbol.toStringTag]: 'Array',
            get length() {
                reads++; return 1
            },
            0: evil(),
        })
        let holeInherited = () => Object.setPrototypeOf(new Array(1), { 0: evil() })
        //[標籤, 容器工廠, 寫入/del之訊息尾(含位置), mix段之訊息尾, 僅限insert與save(fakeTag於mix回既有之need..., 於del為單一列交後端)]
        let containers = [
            ['偽造標籤之類陣列', fakeTag, null],
            ['Proxy陣列', () => counted([okRow(), okRow()]), 'unsupported irregular object or array'],
            ['中間有空洞', () => [okRow(), , okRow()], 'unsupported sparse array: data[1]'], // eslint-disable-line no-sparse-arrays
            ['全為空洞', () => sp(3), 'unsupported sparse array: data[0]'],
            ['空洞且原型帶資料索引', holeInherited, 'unsupported sparse array: data[0]'],
            ['原型鏈有標籤之陣列', () => Object.setPrototypeOf([okRow()], Object.assign(Object.create(Array.prototype), { [Symbol.toStringTag]: 'X' })), 'unsupported irregular object or array'],
            //索引為存取器(可列舉或不可列舉): 其後各步驟以array[index]讀取會執行使用端程式並可每次回傳不同列(外審 sol F01); 由getErrBatch於讀取任何元素之前以描述子拒收, getter 0次
            ['索引為可列舉存取器', () => Object.defineProperty([okRow()], 0, {
                enumerable: true,
                get() {
                    reads++; return okRow()
                }
            }), 'unsupported accessor property: data[0]'],
            ['索引為不可列舉存取器', () => Object.defineProperty([okRow()], 0, {
                enumerable: false,
                get() {
                    reads++; return okRow()
                }
            }), 'unsupported accessor property: data[0]'],
            //已撤銷之Proxy: Array.isArray拋TypeError, 無法分類為陣列或單一列, 於任何讀取與ORM呼叫之前固定拒收(外審 sol F06; mix之形狀檢查視為非陣列)
            ['已撤銷之Proxy陣列', () => {
                let rv = Proxy.revocable([okRow()], {}); rv.revoke(); return rv.proxy
            }, 'unsupported irregular object or array', 'need'],
        ]
        let done = 0
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            for (let [lab, mk, tail, mixNeed] of containers) {
                let L = `${kind} ${lab}`
                reads = 0
                //insert、save
                for (let [mode, msg] of [['insert', 'failed to insert data'], ['save', 'failed to save data']]) {
                    stub.reset()
                    let err = await rj(proc, mode, mk())
                    //偽造標籤者被視為單一列, 由頂層列檢查以irregular回報(其自有標籤使其不乾淨)
                    assert.strictEqual(err, tail === null ? `${msg}, unsupported irregular object or array: data[0]` : `${msg}, ${tail}`, `${L} ${mode}`)
                    assert.deepStrictEqual(calls, [], `${L} ${mode} ORM不應被呼叫`)
                    done++
                }
                //del: 容器檢查適用; 偽造標籤者不被當陣列(原 isarr 為真而依其length迭代), 視為單一列交後端, length getter 0次
                stub.reset()
                if (tail !== null) {
                    assert.strictEqual(await rj(proc, 'del', mk()), `failed to delete data, ${tail}`, `${L} del`)
                    assert.deepStrictEqual(calls, [], `${L} del ORM不應被呼叫`)
                }
                else {
                    let fake = mk()
                    await quiet(() => proc('u1', 'tests', 'del', fake))
                    assert.strictEqual(calls.length, 1, `${L} del 交後端一次`)
                    assert.ok(calls[0].data === fake, `${L} del 以單一列(同一物件)交後端, 不展開為陣列`)
                }
                done++
                //mix: add、del、diff 各為批次容器
                for (let [key, msg] of [['add', 'failed to insert data'], ['del', 'failed to delete data'], ['diff', 'failed to update data']]) {
                    stub.reset()
                    let err = await rj(proc, 'mix', { [key]: mk() })
                    assert.strictEqual(err, tail === null || mixNeed === 'need' ? 'invalid input of mix, need the result object of ltdtDiffByKey' : `${msg}, ${tail}`, `${L} mix.${key}`)
                    assert.deepStrictEqual(calls, [], `${L} mix.${key} ORM不應被呼叫`)
                    done++
                }
                assert.strictEqual(reads, 0, `${L} length getter與陷阱不被執行`)
            }
            //多段並列時以 '; ' 串接(add、del、diff之序)
            stub.reset()
            assert.strictEqual(await rj(proc, 'mix', { add: sp(2), del: [{ id: 'x' }], diff: [okRow(), , okRow()] }), // eslint-disable-line no-sparse-arrays
                'failed to insert data, unsupported sparse array: data[0]; failed to update data, unsupported sparse array: data[1]', `${kind} mix多段`)
            assert.deepStrictEqual(calls, [], `${kind} mix多段 ORM不應被呼叫`)
            //對照(規則3不退化): 同一個含巢狀自有__proto__之列放在一般陣列, 仍以既有訊息reject
            assert.strictEqual(await rj(proc, 'insert', [evil()]), 'failed to insert data, unsupported key[__proto__]: data[0]', `${kind} 對照`)
            //對照: 一般之密陣列與空陣列照常
            await quiet(() => proc('u1', 'tests', 'insert', [okRow(), okRow()]))
            assert.strictEqual(calls.length, 1, `${kind} 一般密陣列照常`)
            stub.reset()
            await quiet(() => proc('u1', 'tests', 'insert', []))
            assert.strictEqual(calls.length, 1, `${kind} 空陣列照舊交ORM(R-INPUT-01 規則1)`)
        }
        assert.strictEqual(done, 3 * ((9 * 2) + 9 + (9 * 3)), '完成數(3表型態 x (9容器 x insert/save + 9 x del + 9 x mix三段))')
    })

    it('S04 稀疏巨陣列(列內巢狀、批次容器 x 六個入口、find之$in): 立即reject, 不逐索引迴圈、不配置同數量之物件, ORM未被呼叫(A-07 ③)', async function() {
        //規則7 ③⑤; 修前: 列內巢狀 1e8 個空洞15.8秒才resolve、2^32-1逾40秒未返回; 批次容器 1e7 個空洞配置606MB, 1e8 OOM
        //有限大小先斷言(1e5): 若檢查被拿掉, 於此即失敗而不致掛住, 再跑極大值
        let build = (len) => [
            //[標籤, 入口, 輸入, 預期]
            ['列內巢狀(陣列列)', 'insert', [{ id: 'a1', arr: sp(len) }], 'failed to insert data, unsupported sparse array: data[0]'],
            ['列內巢狀(單一物件)', 'insert', { id: 'a1', arr: sp(len) }, 'failed to insert data, unsupported sparse array: data[0]'],
            ['列內巢狀(save第2列)', 'save', [okRow(), { id: 'a2', deep: { arr: sp(len) } }], 'failed to save data, unsupported sparse array: data[1]'],
            ['列內巢狀(第0個有值)', 'insert', [{ id: 'a1', arr: Object.assign(sp(len), { 0: 'x' }) }], 'failed to insert data, unsupported sparse array: data[0]'],
            ['mix.add列內巢狀', 'mix', { add: [{ id: 'a1', arr: sp(len) }] }, 'failed to insert data, unsupported sparse array: data[0]'],
            ['mix.diff列內巢狀', 'mix', { diff: [{ id: 'a1', arr: sp(len) }] }, 'failed to update data, unsupported sparse array: data[0]'],
            ['容器 insert', 'insert', sp(len), 'failed to insert data, unsupported sparse array: data[0]'],
            ['容器 save', 'save', sp(len), 'failed to save data, unsupported sparse array: data[0]'],
            ['容器 del', 'del', sp(len), 'failed to delete data, unsupported sparse array: data[0]'],
            ['容器 mix.add', 'mix', { add: sp(len) }, 'failed to insert data, unsupported sparse array: data[0]'],
            ['容器 mix.del', 'mix', { del: sp(len) }, 'failed to delete data, unsupported sparse array: data[0]'],
            ['容器 mix.diff', 'mix', { diff: sp(len) }, 'failed to update data, unsupported sparse array: data[0]'],
        ]
        let findCases = (len) => [
            ['find $in', { id: { $in: sp(len) } }],
            ['find 非id欄位$in', { name: { $in: sp(len) } }],
            ['find 第0個有值', { id: { $in: Object.assign(sp(len), { 0: 'x' }) } }],
        ]
        let done = 0
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            for (let len of [1e5, 2 ** 32 - 1, 1e9]) {
                for (let [lab, mode, input, expected] of build(len)) {
                    stub.reset()
                    let [err, ms] = await elapsed(() => rj(proc, mode, input))
                    assert.strictEqual(err, expected, `${kind} ${lab} len=${len}`)
                    assert.ok(ms < 1000, `${kind} ${lab} len=${len} 耗時 ${ms} ms`)
                    assert.deepStrictEqual(calls, [], `${kind} ${lab} len=${len} ORM不應被呼叫`)
                    done++
                }
                for (let mode of ['select', 'delAll']) {
                    for (let [lab, find] of findCases(len)) {
                        stub.reset()
                        let [err, ms] = await elapsed(() => rj(proc, mode, find))
                        assert.strictEqual(err, `invalid find of ${mode}, unsupported irregular object or array`, `${kind} ${mode} ${lab} len=${len}`)
                        assert.ok(ms < 1000, `${kind} ${mode} ${lab} len=${len} 耗時 ${ms} ms`)
                        assert.deepStrictEqual(calls, [], `${kind} ${mode} ${lab} len=${len} ORM不應被呼叫`)
                        done++
                    }
                }
            }
        }
        assert.strictEqual(done, 3 * 3 * (12 + 2 * 3), '完成數(3表型態 x 3長度 x (12 + 2 x 3))')
    })

})


describe('R-MIX-01 規則6 mix之同鍵比對所見之id即實際寫入或刪除所用之id(S05)', function() {

    beforeEach(function() {
        stub.reset()
    })

    let KINDS = ['str', 'unknown', 'int']
    let hide = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true })
    let rj = (proc, input) => quiet(() => getReject(proc('u1', 'tests', 'mix', input)))
    let msgDelIrregular = (ks) => `failed to delete data, unsupported irregular object or array: ${ks.map((k) => `data[${k}]`).join(', ')}`

    it('S05 不可列舉或繼承之id不參與同鍵比對(原誤拒), 自有可列舉之同鍵仍reject; mix.del列之id為存取器、繼承、Proxy、帶標籤者整批reject(F6)', async function() {
        //規則: R-MIX-01 規則1、6; 修前 add 列 id 為不可列舉 'a1' 且 del 列 id 'a1' 被誤拒為 same id(寫入者實為補值之主鍵); mix.del 列 id 為 getter 時比對所見與後端所用不同
        let done = 0
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            let cast = kind !== 'int'
            //不再誤拒: add/diff 列之 id 非自有可列舉 → 視為未提供(補主鍵), del 照常
            for (let [lab, mkRow] of [
                ['自有不可列舉', () => hide({ name: 'new' }, 'id', 'a1')],
                ['繼承', () => Object.assign(Object.create({ id: 'a1' }), { name: 'new' })],
            ]) {
                for (let [seg, mkInput, order] of [
                    ['add', (r) => ({ add: [r], del: [{ id: 'a1' }] }), ['insert', 'del']],
                    ['diff', (r) => ({ del: [{ id: 'a1' }], diff: [r] }), ['del', 'save']],
                ]) {
                    stub.reset()
                    await quiet(() => proc('u1', 'tests', 'mix', mkInput(mkRow())))
                    assert.deepStrictEqual(calls.map((v) => v.fn), order, `${kind} ${lab} ${seg} 呼叫序`)
                    let written = calls.find((v) => v.fn !== 'del').data[0]
                    assert.strictEqual(written.name, 'new', `${kind} ${lab} ${seg}`)
                    if (cast) {
                        assert.ok(isGen(written.id), `${kind} ${lab} ${seg} 補主鍵, 實收 ${String(written.id)}`)
                    }
                    else {
                        assert.ok(!Object.prototype.hasOwnProperty.call(written, 'id'), `${kind} ${lab} ${seg} 整數型表不補值`)
                    }
                    same(calls.find((v) => v.fn === 'del').data, [{ id: 'a1' }], `${kind} ${lab} ${seg} del`)
                    done++
                }
            }
            //數字之不可列舉id: 同樣不參與比對
            stub.reset()
            await quiet(() => proc('u1', 'tests', 'mix', { add: [hide({ name: 'new' }, 'id', 5)], del: [{ id: 5 }] }))
            assert.deepStrictEqual(calls.map((v) => v.fn), ['insert', 'del'], `${kind} 數字`)
            assert.strictEqual(calls[1].data[0].id, cast ? '5' : 5, `${kind} 數字 del`)
            done++
            //對照(R-MIX-01 不退化): 自有可列舉之同鍵仍整批reject, 不寫入任何一筆
            stub.reset()
            assert.strictEqual(await rj(proc, { add: [{ id: 'a1', name: 'new' }], del: [{ id: 'a1' }] }), 'invalid input of mix, same id in add and del: add[0], del[0]', `${kind} 同鍵`)
            if (cast) {
                assert.strictEqual(await rj(proc, { add: [{ id: 5 }], del: [{ id: '5' }] }), 'invalid input of mix, same id in add and del: add[0], del[0]', `${kind} 數字與字串同鍵(R-ID-02)`)
            }
            assert.deepStrictEqual(calls, [], `${kind} ORM不應被呼叫`)
            done++

            //mix.del 列: 存取器、繼承、Proxy、帶標籤 → 整批reject並列位置; getter與陷阱0次
            let c = { n: 0 }
            let withGetter = (enumerable) => {
                let r = {}
                Object.defineProperty(r, 'id', {
                    enumerable,
                    get() {
                        c.n++; return 'a7'
                    }
                })
                return r
            }
            class Inh {
                get id() {
                    c.n++
                    return 'a7'
                }
            }
            let mkProxy = () => new Proxy({ id: 'a7' }, {
                get(t, k, r) {
                    c.n++; return Reflect.get(t, k, r)
                },
                getOwnPropertyDescriptor(t, k) {
                    c.n++; return Reflect.getOwnPropertyDescriptor(t, k)
                }
            })
            let dels = [
                { id: 'ok1' }, //0
                withGetter(true), //1 自有可列舉存取器
                { id: 'ok2' }, //2
                Object.create({ id: 'a7' }), //3 繼承資料屬性
                withGetter(false), //4 自有不可列舉存取器
                new Inh(), //5 繼承存取器
                mkProxy(), //6 Proxy
                { id: 'a7', [Symbol.toStringTag]: 'X' }, //7 帶標籤
                hide({}, 'id', 'ok3'), //8 自有不可列舉資料屬性: 拒收(各後端讀法未必相同, 以同鍵防線之前提為重, fail-closed)
                Object.assign(Object.create(null), { id: 'ok4' }), //9 null原型
            ]
            stub.reset()
            assert.strictEqual(await rj(proc, { add: [{ id: 'a7', name: 'added' }], del: dels }), msgDelIrregular([1, 3, 4, 5, 6, 7, 8]), `${kind} mix.del 多筆`)
            assert.strictEqual(c.n, 0, `${kind} getter與陷阱不被執行`)
            assert.deepStrictEqual(calls, [], `${kind} ORM不應被呼叫(修前: add之a7新增後隨即被後端依getter所讀之a7刪除而resolve)`)
            done++
            //僅合法列: 照常, 且add與del之同鍵比對仍運作
            stub.reset()
            await quiet(() => proc('u1', 'tests', 'mix', { add: [{ id: 'n1' }], del: [dels[0], dels[2], dels[9]] }))
            assert.deepStrictEqual(calls.map((v) => v.fn), ['insert', 'del'], `${kind} 合法mix.del`)
            done++
        }
        assert.strictEqual(done, 3 * (4 + 1 + 1 + 1 + 1), '完成數')
    })

})


describe('R-OBJ-01 規則5 續 find之最長路徑深度與展開後容器數(S06、S07)', function() {

    beforeEach(function() {
        stub.reset()
    })

    let MAX_DEPTH = 64 //容器層, 根為第1層
    let MAX_NODES = 100000 //展開後容器數(共用子結構依出現次數重複計)
    let deep = (mode) => `invalid find of ${mode}, too deep`
    let large = (mode) => `invalid find of ${mode}, too large`
    let rj = (proc, mode, input) => quiet(() => getReject(proc('u1', 'tests', mode, input)))
    //m個巢狀容器之鏈: {a:{a:...{id:'a1'}}}
    let chainObj = (m) => {
        let x = { id: 'a1' }
        for (let i = 1; i < m; i++) {
            x = { a: x }
        }
        return x
    }
    //共用鏈S之DAG: 根之最長路徑為 m+2 個容器.三種鍵序,使「首次到達之走訪」(getReasonBadKey,堆疊後進先出,後面的鍵先被走訪)與「最長路徑之走訪」(measureFind,鍵序先到先走)各異:
    //  'q-first': {q:{r:S}, p:S}  getReasonBadKey 先走p(S在第2層, 修前之首次到達深度僅 1+m 而通過); measureFind 先走q(深路徑先展開, 由堆疊深度抓到)
    //  'p-first': {p:S, q:{r:S}}  getReasonBadKey 先走q(深路徑先到達, 由首次到達之深度檢查抓到)
    //  'tri': {a:S, b:{r:S}, c:S}  兩個走訪都先經淺路徑展開S,深路徑最後才重用已完成之S: 只有 measureFind 之共用節點檢查(或完成時檢查)抓得到
    let dagRoot = (m, order) => {
        let s = chainObj(m)
        return order === 'q-first' ? { q: { r: s }, p: s } : order === 'p-first' ? { p: s, q: { r: s } } : { a: s, b: { r: s }, c: s }
    }
    //指數型DAG: x_{i+1}={$and:[x_i,x_i]}, 展開後物件數 2^(k+1)-1(含陣列之容器數為 3*2^k-2), 相異容器 2k+1, 最長路徑 2k+1
    let expDag = (k) => {
        let x = { id: 'a1' }
        for (let i = 0; i < k; i++) {
            x = { $and: [x, x] }
        }
        return x
    }

    it('S06 共用子結構: 最長路徑恰64個容器通過、65個reject(含首次到達較淺之DAG); 展開後容器數恰100,000通過、100,001reject; 循環reject; 合理重用照常(A-07 ①②)', async function() {
        //規則5續; 修前: 首次到達深度僅1+m, 最長路徑65~403個容器之DAG通過; 展開數無上限, 指數型DAG展開2^k個物件
        let done = 0
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                let L = `${kind} ${mode}`
                //最長路徑邊界(三種鍵序)
                for (let order of ['q-first', 'p-first', 'tri']) {
                    for (let [m, ok] of [[61, true], [62, true], [63, false], [64, false], [200, false]]) {
                        stub.reset()
                        if (ok) {
                            await quiet(() => proc('u1', 'tests', mode, dagRoot(m, order)))
                            assert.strictEqual(calls.length, 1, `${L} dag m=${m} ${order} 通過(最長路徑${m + 2})`)
                        }
                        else {
                            assert.strictEqual(await rj(proc, mode, dagRoot(m, order)), deep(mode), `${L} dag m=${m} ${order} (最長路徑${m + 2})`)
                            assert.strictEqual(calls.length, 0, `${L} dag m=${m} ORM不應被呼叫`)
                        }
                        done++
                    }
                }
                //展開後物件數邊界(陣列不計): 根(1)+N個共用之葉各算1
                let leaf = { id: 'a1' }
                for (let [n, ok] of [[MAX_NODES - 1, true], [MAX_NODES, false]]) {
                    stub.reset()
                    let find = { $or: Array.from({ length: n }, () => leaf) }
                    if (ok) {
                        await quiet(() => proc('u1', 'tests', mode, find))
                        assert.strictEqual(calls.length, 1, `${L} 兄弟${n}個(展開${n + 1})通過`)
                    }
                    else {
                        assert.strictEqual(await rj(proc, mode, find), large(mode), `${L} 兄弟${n}個(展開${n + 1})`)
                        assert.strictEqual(calls.length, 0, `${L} 兄弟${n}個 ORM不應被呼叫`)
                    }
                    done++
                }
                //無共用之樹(各葉為相異物件): 根(1)+N個葉(陣列不計); 恰100,000通過、100,001 reject(不能以「有無共用參考」捷徑略過展開數)
                for (let [n, ok] of [[MAX_NODES - 1, true], [MAX_NODES, false]]) {
                    stub.reset()
                    let tree = { $or: Array.from({ length: n }, () => ({ id: 'a1' })) }
                    if (ok) {
                        await quiet(() => proc('u1', 'tests', mode, tree))
                        assert.strictEqual(calls.length, 1, `${L} 無共用之樹${n}葉(展開${n + 1})通過`)
                    }
                    else {
                        assert.strictEqual(await rj(proc, mode, tree), large(mode), `${L} 無共用之樹${n}葉(展開${n + 1})`)
                        assert.strictEqual(calls.length, 0, `${L} 無共用之樹${n}葉 ORM不應被呼叫`)
                    }
                    done++
                }
                //以Date為葉之深度邊界: Date不是容器, 恰64個容器(深端為{d: Date})通過、65個reject
                for (let [m, ok] of [[64, true], [65, false]]) {
                    stub.reset()
                    let x = { d: new Date() }
                    for (let i = 1; i < m; i++) {
                        x = { a: x }
                    }
                    if (ok) {
                        await quiet(() => proc('u1', 'tests', mode, x))
                        assert.strictEqual(calls.length, 1, `${L} Date葉 ${m}個容器通過`)
                    }
                    else {
                        assert.strictEqual(await rj(proc, mode, x), deep(mode), `${L} Date葉 ${m}個容器`)
                        assert.strictEqual(calls.length, 0, `${L} Date葉 ${m}個容器 ORM不應被呼叫`)
                    }
                    done++
                }
                //同上, 但共用之葉直接掛在根物件之N個鍵下(根自己累計): 根(1)+N個共用之葉; 恰100,000通過、100,001 reject(以根為累計者計入之邊界不同於陣列)
                for (let [n, ok] of [[MAX_NODES - 1, true], [MAX_NODES, false]]) {
                    stub.reset()
                    let wide = {}
                    for (let i = 0; i < n; i++) {
                        wide[`k${i}`] = leaf
                    }
                    if (ok) {
                        await quiet(() => proc('u1', 'tests', mode, wide))
                        assert.strictEqual(calls.length, 1, `${L} 根${n}鍵(展開${n + 1})通過`)
                    }
                    else {
                        assert.strictEqual(await rj(proc, mode, wide), large(mode), `${L} 根${n}鍵(展開${n + 1})`)
                        assert.strictEqual(calls.length, 0, `${L} 根${n}鍵 ORM不應被呼叫`)
                    }
                    done++
                }
                //指數型DAG: k=15 展開65,535個物件通過; k=16 展開131,071個物件 reject
                for (let [k, ok] of [[15, true], [16, false]]) {
                    stub.reset()
                    if (ok) {
                        await quiet(() => proc('u1', 'tests', mode, expDag(k)))
                        assert.strictEqual(calls.length, 1, `${L} expDag k=${k} 通過`)
                    }
                    else {
                        assert.strictEqual(await rj(proc, mode, expDag(k)), large(mode), `${L} expDag k=${k}`)
                        assert.strictEqual(calls.length, 0, `${L} expDag k=${k} ORM不應被呼叫`)
                    }
                    done++
                }
                //極端指數(含最長路徑僅63):  整數型/無該表者原物件交ORM不展開, 修前不致崩潰; 字串型/未知型於修前展開 2^31 個物件, 故只於不經castIdFind之表型態測(其餘由k=16~20涵蓋同一程式路徑)
                if (kind === 'int' || kind === 'none') {
                    for (let [k, msg] of [[21, large(mode)], [31, large(mode)], [32, deep(mode)], [60, deep(mode)], [5000, deep(mode)]]) {
                        stub.reset()
                        let [err, ms] = await (async () => {
                            let t = Date.now()
                            let e = await rj(proc, mode, expDag(k))
                            return [e, Date.now() - t]
                        })()
                        assert.strictEqual(err, msg, `${L} expDag k=${k}`)
                        assert.ok(ms < 1000, `${L} expDag k=${k} 耗時 ${ms} ms`)
                        assert.strictEqual(calls.length, 0, `${L} expDag k=${k} ORM不應被呼叫`)
                        done++
                    }
                }
                else {
                    //k=20於修前約1秒、+213MB後交ORM; 修後立即reject
                    stub.reset()
                    let t = Date.now()
                    assert.strictEqual(await rj(proc, mode, expDag(20)), large(mode), `${L} expDag k=20`)
                    assert.ok(Date.now() - t < 1000, `${L} expDag k=20 耗時 ${Date.now() - t} ms`)
                    assert.strictEqual(calls.length, 0, `${L} expDag k=20 ORM不應被呼叫`)
                    done++
                }
                //循環(物件自指、$and自指、間接): 所有表型態皆固定訊息reject, ORM未被呼叫
                let cyc1 = { $and: [] }
                cyc1.$and.push(cyc1)
                let cyc2 = { id: 'a1' }
                cyc2.self = cyc2
                let cyc3 = { x: { y: { z: {} } } }
                cyc3.x.y.z.back = cyc3.x
                for (let [lab, cyc] of [['$and自指', cyc1], ['物件自指', cyc2], ['間接', cyc3]]) {
                    stub.reset()
                    assert.strictEqual(await rj(proc, mode, cyc), deep(mode), `${L} 循環 ${lab}`)
                    assert.strictEqual(calls.length, 0, `${L} 循環 ${lab} ORM不應被呼叫`)
                    done++
                }
                //合理之重用: 同一子條件於1000處(展開4,002個容器)照常
                let sub = { name: 'x' }
                stub.reset()
                await quiet(() => proc('u1', 'tests', mode, { $or: Array.from({ length: 1000 }, () => ({ $and: [sub, sub] })) }))
                assert.strictEqual(calls.length, 1, `${L} 合理重用`)
                done++
            }
        }
        //kinds 4(str、unknown、int、none) x mode 2 x [dag 10 + 兄弟2 + expDag 2 + 極端(int、none 5; str、unknown 1) + 循環3 + 重用1]
        assert.strictEqual(done, 2 * (2 * (15 + 2 + 2 + 2 + 2 + 2 + 5 + 3 + 1) + 2 * (15 + 2 + 2 + 2 + 2 + 2 + 1 + 3 + 1)), '完成數')
    })

    it('S07 隨機分層DAG(固定種子, 樸素遞迴之BigInt預言機): 最長路徑>64或展開>100,000 ⇔ reject(too deep或too large), 兩側皆有案例', async function() {
        //規則5續; 預言機: 逐路徑展開之容器數與最長路徑, 獨立於被測之記憶化演算法
        let seed = 20261020
        let rnd = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return seed / 4294967296
        }
        let ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
        let gen = () => {
            let L = ri(1, 40)
            let w = ri(1, 3)
            let f = ri(1, 3)
            let layers = []
            layers[L] = Array.from({ length: w }, () => ({ id: 'a' }))
            for (let l = L - 1; l >= 0; l--) {
                layers[l] = Array.from({ length: w }, () => ({ $and: Array.from({ length: ri(1, f) }, () => layers[l + 1][ri(0, w - 1)]) }))
            }
            return rnd() < 0.5 ? { $or: layers[0] } : layers[0][0] //前者令第0層全部置於淺層, 重現首次到達深度之繞過
        }
        let oracle = (root) => {
            let m = new Map()
            let go = (o) => {
                if (o === null || typeof o !== 'object') {
                    return { d: 0, n: 0n }
                }
                if (m.has(o)) {
                    return m.get(o)
                }
                let d = 0
                let n = Array.isArray(o) ? 0n : 1n //展開數只計物件(不含陣列)
                for (let k of Object.keys(o)) {
                    let c = go(o[k])
                    d = Math.max(d, c.d)
                    n += c.n
                }
                let r = { d: d + 1, n }
                m.set(o, r)
                return r
            }
            return go(root)
        }
        let kinds = getKinds()
        let procInt = kinds.find((v) => v.kind === 'int').proc
        let procStr = kinds.find((v) => v.kind === 'str').proc
        let tally = { pass: 0, deep: 0, large: 0 }
        let N = 1500
        for (let i = 0; i < N; i++) {
            let root = gen()
            let o = oracle(root)
            let expectReject = o.d > MAX_DEPTH || o.n > BigInt(MAX_NODES)
            stub.reset()
            //整數型表: 全部案例(不經castIdFind, 修前亦不致展開)
            let r = await quiet(() => procInt('u1', 'tests', 'select', root).then(() => 'ok', (e) => String(e)))
            if (!expectReject) {
                assert.strictEqual(r, 'ok', `#${i} 預言機: 最長路徑${o.d} 展開${o.n} 應通過`)
                assert.strictEqual(calls.length, 1, `#${i}`)
                tally.pass++
                //字串型表: 僅預言機判通過者(展開 ≤ 100,000, 修前亦安全)
                stub.reset()
                await quiet(() => procStr('u1', 'tests', 'select', root))
                assert.strictEqual(calls.length, 1, `#${i} 字串型表通過`)
            }
            else {
                assert.ok(r === deep('select') || r === large('select'), `#${i} 預言機: 最長路徑${o.d} 展開${o.n} 應reject, 實得 ${r}`)
                assert.strictEqual(calls.length, 0, `#${i} ORM不應被呼叫`)
                if (r === deep('select')) {
                    tally.deep++
                }
                else {
                    tally.large++
                }
            }
        }
        assert.strictEqual(tally.pass + tally.deep + tally.large, N, '完成數')
        assert.ok(tally.pass > 300 && tally.deep > 100 && tally.large > 100, `三類皆有足量案例 ${JSON.stringify(tally)}`)
    })

})


describe('JSON來源之一般輸入行為鎖定(S08): 第82項修正不改變資料通道可達之輸入', function() {

    beforeEach(function() {
        stub.reset()
    })

    //預言機: 樸素之參考實作(R-ID-02 轉型、R-ID-01 補值、R-INPUT-01 形狀), 輸入一律為 JSON.parse(JSON.stringify()) 之樹, 與修正前後之行為皆相同
    //(同一語料於 HEAD 之 src 亦全綠, 證明預言機本身正確; 修正後仍全綠, 證明 JSON 來源之行為未變)
    const GEN = '<GEN>'
    const OPS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin']
    let castId = (v, cast) => (cast && typeof v === 'number' && Number.isFinite(v) ? String(v) : v)
    let refCond = (c, cast) => {
        if (!cast) {
            return c
        }
        if (c !== null && typeof c === 'object' && !Array.isArray(c)) {
            let r = {}
            for (let k of Object.keys(c)) {
                r[k] = OPS.includes(k) ? (Array.isArray(c[k]) ? c[k].map((x) => castId(x, true)) : castId(c[k], true)) : c[k]
            }
            return r
        }
        return castId(c, true)
    }
    let refFind = (f, cast) => {
        if (!cast || f === null || typeof f !== 'object') {
            return f
        }
        let r = {}
        for (let k of Object.keys(f)) {
            if (k === 'id') {
                r[k] = refCond(f[k], true)
            }
            else if ((k === '$and' || k === '$or') && Array.isArray(f[k])) {
                r[k] = f[k].map((x) => refFind(x, true))
            }
            else {
                r[k] = f[k]
            }
        }
        return r
    }
    //寫入列: 轉型後, 有效輸入(單一物件須非空; 陣列須長度>=2, 或長度1而該列非空)才補主鍵(R-ID-01 規則3)
    let refWrite = (data, cast) => {
        let one = !Array.isArray(data)
        let rows = (one ? [data] : data).map((v) => ({ ...v, ...(cast && 'id' in v ? { id: castId(v.id, true) } : {}) }))
        let effective = one ? Object.keys(rows[0]).length > 0 : (rows.length >= 2 || (rows.length === 1 && Object.keys(rows[0]).length > 0))
        if (cast && effective) {
            rows = rows.map((v) => (typeof v.id === 'string' && v.id.length > 0 ? v : { ...v, id: GEN }))
        }
        return one ? rows[0] : rows
    }
    let refDel = (data, cast) => {
        let one = !Array.isArray(data)
        let rows = (one ? [data] : data).map((v) => (cast && typeof v.id === 'number' && Number.isFinite(v.id) ? { ...v, id: String(v.id) } : v))
        return one ? rows[0] : rows
    }
    let norm = (d) => {
        let nr = (r) => (r !== null && typeof r === 'object' && isGen(r.id) ? { ...r, id: GEN } : r)
        return Array.isArray(d) ? d.map(nr) : nr(d)
    }

    //語料(固定種子)
    let seed = 8008
    let rnd = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296
        return seed / 4294967296
    }
    let pick = (a) => a[Math.floor(rnd() * a.length)]
    let STR = ['', 'a1', 'a2', 'beta', '中文', 'x y', '12', 'length', 'true']
    let NUM = [0, 1, 5, 123, -1, 1.5, 1e21, 0.1]
    let KEY = ['name', 'meta', 'length', 'x', 'y', 'arr']
    let scalar = () => {
        let r = rnd()
        return r < 0.45 ? pick(STR) : r < 0.8 ? pick(NUM) : r < 0.9 ? null : rnd() < 0.5
    }
    let value = (d) => {
        let r = rnd()
        if (d <= 0 || r < 0.5) {
            return scalar()
        }
        if (r < 0.75) {
            return Array.from({ length: Math.floor(rnd() * 4) }, () => value(d - 1))
        }
        let o = {}
        for (let i = Math.floor(rnd() * 4); i > 0; i--) {
            o[pick(KEY)] = value(d - 1)
        }
        return o
    }
    //row(strPool, numBase): id 之形態: 非空字串、有限數字、null、''、布林、物件、陣列、缺
    //special: 非mix之入口另含特殊數字id(0、負數、小數、1e21)——mix各段之id須互不相同, 不含
    let row = (sp, nb, special = false) => {
        let o = {}
        let r = rnd()
        if (r < 0.4) {
            o.id = `${sp}${Math.floor(rnd() * 5)}`
        }
        else if (r < 0.65) {
            o.id = special && rnd() < 0.5 ? pick([0, -1, 1.5, 1e21, 0.1]) : nb + Math.floor(rnd() * 5)
        }
        else if (r < 0.7) {
            o.id = null
        }
        else if (r < 0.75) {
            o.id = ''
        }
        else if (r < 0.8) {
            o.id = rnd() < 0.5
        }
        else if (r < 0.85) {
            o.id = rnd() < 0.5 ? { a: 1 } : [1]
        }
        for (let i = Math.floor(rnd() * 4); i > 0; i--) {
            o[pick(KEY)] = value(3)
        }
        return o
    }
    let rows = (sp, nb, special = false) => {
        let r = rnd()
        return r < 0.25 ? row(sp, nb, special) : r < 0.3 ? [] : r < 0.35 ? {} : r < 0.4 ? [{}] : Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => row(sp, nb, special))
    }
    let idCond = () => {
        let r = rnd()
        if (r < 0.4) {
            return scalar()
        }
        let o = {}
        for (let i = 1 + Math.floor(rnd() * 2); i > 0; i--) {
            let op = pick([...OPS, '$regex'])
            o[op] = op === '$in' || op === '$nin' ? Array.from({ length: Math.floor(rnd() * 4) }, scalar) : scalar()
        }
        return o
    }
    let find = (d) => {
        let o = {}
        if (rnd() < 0.6) {
            o.id = idCond()
        }
        if (rnd() < 0.5) {
            o.name = scalar()
        }
        if (rnd() < 0.2) {
            o.length = pick([0, 1, 3.5, '2'])
        }
        if (d > 0 && rnd() < 0.35) {
            o[pick(['$and', '$or'])] = Array.from({ length: Math.floor(rnd() * 3) }, () => find(d - 1))
        }
        return o
    }
    let topFind = () => {
        let r = rnd()
        return r < 0.04 ? null : r < 0.07 ? [] : r < 0.09 ? 'x' : r < 0.11 ? 5 : r < 0.15 ? undefined : find(3)
    }
    let json = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
    let N = 400

    it('S08 JSON來源之列與條件(insert、save、del、mix、select、delAll x 字串型/未知型/整數型/無該表): ORM收到之實參與參考實作逐組相同', async function() {
        //R-ID-02、R-ID-01、R-INPUT-01 於 JSON 可表達之輸入上的行為; 第82項修正(規則7、規則5續)不得改變
        let done = 0
        let tally = { ok: 0, reject: 0 }
        for (let { kind, proc } of getKinds()) {
            let cast = kind === 'str' || kind === 'unknown'
            let modes = kind === 'none' ? ['del', 'select', 'delAll'] : ['insert', 'save', 'del', 'mix', 'select', 'delAll']
            for (let mode of modes) {
                for (let i = 0; i < N; i++) {
                    stub.reset()
                    let L = `${kind} ${mode} #${i}`
                    let input
                    let expectErr = null
                    let expectCalls
                    if (mode === 'insert' || mode === 'save') {
                        input = json(rows('A', 1000, true))
                        expectCalls = [{ fn: mode, data: refWrite(json(input), cast) }]
                    }
                    else if (mode === 'del') {
                        input = json(rows('D', 2000, true))
                        expectCalls = [{ fn: 'del', data: refDel(json(input), cast) }]
                    }
                    else if (mode === 'mix') {
                        input = {}
                        let add = rnd() < 0.7 ? json(Array.from({ length: Math.floor(rnd() * 3) }, () => row('A', 1000))) : undefined
                        let del = rnd() < 0.7 ? json(Array.from({ length: Math.floor(rnd() * 3) }, () => row('D', 2000))) : undefined
                        let diff = rnd() < 0.5 ? json(Array.from({ length: Math.floor(rnd() * 3) }, () => row('F', 3000))) : undefined
                        for (let [k, v] of [['add', add], ['del', del], ['diff', diff]]) {
                            if (v !== undefined) {
                                input[k] = v
                            }
                        }
                        if (Object.keys(input).length === 0) {
                            input.add = []
                        }
                        expectCalls = []
                        if (add && add.length > 0) {
                            expectCalls.push({ fn: 'insert', data: refWrite(json(add), cast) })
                        }
                        if (del && del.length > 0) {
                            expectCalls.push({ fn: 'del', data: refDel(json(del), cast) })
                        }
                        if (diff && diff.length > 0) {
                            expectCalls.push({ fn: 'save', data: refWrite(json(diff), cast) })
                        }
                    }
                    else {
                        input = topFind()
                        if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
                            expectErr = `invalid find of ${mode}, need an object`
                            expectCalls = []
                        }
                        else {
                            input = json(input)
                            expectCalls = [{ fn: mode, data: refFind(json(input), cast) }]
                        }
                    }
                    let got = await quiet(() => proc('u1', 'tests', mode, json(input)).then(() => null, (e) => String(e)))
                    assert.strictEqual(got, expectErr, `${L} reject`)
                    same(calls.map((v) => ({ fn: v.fn, data: norm(v.data) })), expectCalls, `${L} ORM收到`)
                    tally[expectErr === null ? 'ok' : 'reject']++
                    done++
                }
            }
        }
        assert.strictEqual(done, N * (3 * 6 + 3), '完成數')
        assert.ok(tally.ok > 7000 && tally.reject > 100, `通過與reject兩側皆有案例 ${JSON.stringify(tally)}`)
    })

})


//R-OBJ-01 規則7 續(第82項 run02, 外審 sol 第一輪 F01~F04、F06~F09): 通過檢查之後不再執行使用端程式, 且檢查之值即使用之值
describe('R-OBJ-01 規則7 續 檢查之後不執行使用端程式(S09~S14)', function() {

    beforeEach(function() {
        stub.reset()
    })

    let KINDS = ['str', 'unknown', 'int']
    let IRREG = 'unsupported irregular object or array'
    let msgWrite = { 'insert': 'failed to insert data', 'save': 'failed to save data', 'mix.add': 'failed to insert data', 'mix.diff': 'failed to update data' }
    let runW = (proc, entry, row) => {
        switch (entry) {
        case 'insert': return proc('u1', 'tests', 'insert', [row])
        case 'save': return proc('u1', 'tests', 'save', [row])
        case 'mix.add': return proc('u1', 'tests', 'mix', { add: [row] })
        case 'mix.diff': return proc('u1', 'tests', 'mix', { diff: [row] })
        }
        throw new Error(`entry ${entry}`)
    }
    let rjS = (proc, mode, input) => quiet(() => getReject(proc('u1', 'tests', mode, input)))
    let hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
    let firstRow = () => (Array.isArray(calls[0].data) ? calls[0].data[0] : calls[0].data)
    let okRow = () => ({ id: 'a1', name: 'x' })

    it('S09 函數型列(宣稱Object標籤之函數、callable Proxy、標籤getter拋使用端字串者): 寫入列與mix.del列整批irregular, 陷阱與getter 0次, 不轉出使用端字串; 無標籤之普通函數維持not an object(F02)', async function() {
        //規則7 ②; 修前: isIrregularRow 以 typeof object 為前提而略過函數, isobj 卻相信函數之標籤而當成列複製; 標籤getter拋字串時被邊界保證當成本層固定訊息原樣轉出
        let reads = 0
        let tagged = () => {
            let f = function() {}
            f.id = 'f1'
            f[Symbol.toStringTag] = 'Object'
            return f
        }
        let callableProxy = () => new Proxy(function() {}, {
            get(t, k, r) {
                reads++
                return Reflect.get(t, k, r)
            },
            getOwnPropertyDescriptor(t, k) {
                reads++
                return Reflect.getOwnPropertyDescriptor(t, k)
            },
        })
        let throwing = () => {
            let f = function() {}
            Object.defineProperty(f, Symbol.toStringTag, {
                get() {
                    reads++
                    throw 'SECRET-USER-STRING' // eslint-disable-line no-throw-literal
                },
            })
            return f
        }
        let done = 0
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            for (let [lab, mk] of [['宣稱Object標籤之函數', tagged], ['callable Proxy', callableProxy], ['標籤getter拋使用端字串之函數', throwing]]) {
                for (let entry of ['insert', 'save', 'mix.add', 'mix.diff']) {
                    stub.reset()
                    let err = await quiet(() => getReject(runW(proc, entry, mk())))
                    assert.strictEqual(err, `${msgWrite[entry]}, ${IRREG}: data[0]`, `${kind} ${lab} ${entry}`)
                    assert.deepStrictEqual(calls, [], `${kind} ${lab} ${entry} ORM不應被呼叫`)
                    done++
                }
                stub.reset()
                let err = await quiet(() => getReject(proc('u1', 'tests', 'mix', { add: [okRow()], del: [mk()] })))
                assert.strictEqual(err, `failed to delete data, ${IRREG}: data[0]`, `${kind} ${lab} mix.del`)
                assert.deepStrictEqual(calls, [], `${kind} ${lab} mix.del ORM不應被呼叫`)
                done++
            }
            assert.strictEqual(reads, 0, `${kind} 陷阱與getter不被執行`)
            //對照: 無標籤之普通函數維持既有之 not an object; mix.del 之普通函數同單獨del交後端逐筆處置
            stub.reset()
            assert.strictEqual(await rjS(proc, 'insert', [function() {}]), 'failed to insert data, not an object: data[0]', `${kind} 普通函數`)
            stub.reset()
            await quiet(() => proc('u1', 'tests', 'mix', { del: [function() {}] }))
            assert.strictEqual(calls.length, 1, `${kind} mix.del 普通函數交後端`)
        }
        assert.strictEqual(done, 3 * 3 * 5, '完成數')
    })

    it('S10 通過檢查後之複製不執行getter: 數字id列帶可列舉Symbol getter、del列帶其他getter, 皆0次; 模擬後端於del步驟讀取del列時其副作用不得改動尚未寫入之add與diff(F03)', async function() {
        //規則7 ①; 修前: castIdRows 以 { ...v, id } 展開, 會讀取可列舉Symbol鍵之getter與del列之其他getter(此時寫入列已通過鍵檢查而尚未clearXSS), getter可向已檢查之meta加入自有__proto__
        let reads = 0
        let mkSym = () => {
            let row = { id: 123, name: 'n', meta: {} }
            Object.defineProperty(row, Symbol('s'), {
                enumerable: true,
                get() {
                    reads++
                    Object.defineProperty(row.meta, '__proto__', { value: { unchecked: 1 }, enumerable: true, configurable: true, writable: true })
                    return 0
                },
            })
            return row
        }
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            for (let entry of ['insert', 'save', 'mix.add', 'mix.diff']) {
                stub.reset()
                await quiet(() => runW(proc, entry, mkSym()))
                assert.strictEqual(calls.length, 1, `${kind} ${entry}`)
                assert.strictEqual(reads, 0, `${kind} ${entry} Symbol getter不被執行`)
                assert.ok(!hasOwn(firstRow().meta, '__proto__'), `${kind} ${entry} 寫入之meta無自有__proto__`)
            }
        }
        //模擬後端: del步驟讀取del列之全部自有鍵(真ORM之cloneDeep會執行getter)
        let calls2 = []
        let WOrmReading = function() {
            let ev = {}
            for (let fn of ['select', 'insert', 'save', 'del', 'delAll']) {
                ev[fn] = async (data) => {
                    calls2.push({ fn, data })
                    if (fn === 'del') {
                        for (let row of data) {
                            for (let k of Object.keys(row)) {
                                row[k] //eslint-disable-line no-unused-expressions
                            }
                        }
                    }
                    let n = Array.isArray(data) ? data.length : 1
                    return fn === 'insert' || fn === 'delAll' ? { n: 1, nInserted: 1, ok: 1 } : Array.from({ length: n }, () => ({ n: 1, nModified: 1, nDeleted: 1, ok: 1 }))
                }
            }
            return ev
        }
        for (let [kind, ds] of [['str', dsStr], ['int', dsInt]]) {
            let procR = WServOrm(ds, WOrmReading, 'u', 'd').procOrm
            calls2.length = 0
            reads = 0
            let addRow = { id: 'n1', name: 'add', meta: {} }
            let diffRow = { id: 'f1', name: 'diff', meta: {} }
            let delRow = {
                id: 5,
                get unused() {
                    reads++
                    for (let r of [addRow, diffRow]) {
                        Object.defineProperty(r.meta, '__proto__', { value: { unchecked: 1 }, enumerable: true, configurable: true, writable: true })
                    }
                    return 0
                },
            }
            await quiet(() => procR('u1', 'tests', 'mix', { add: [addRow], del: [delRow], diff: [diffRow] }))
            assert.deepStrictEqual(calls2.map((v) => v.fn), ['insert', 'del', 'save'], `${kind} 呼叫序`)
            assert.strictEqual(reads, 1, `${kind} getter僅由後端於del步驟執行一次(本層不執行)`)
            for (let c of calls2.filter((v) => v.fn !== 'del')) {
                assert.ok(!hasOwn(c.data[0].meta, '__proto__'), `${kind} ${c.fn} 寫入之meta無自有__proto__(adjustData之深複本早於del步驟)`)
            }
        }
    })

    it('S11 稽核欄位(userId、timeCreate、userIdUpdate、timeUpdate)以defineProperty寫入, 不執行原型上之setter: 不改寫id、不加入未檢查之欄位; 凍結列仍為failed to adjust data; 字串主鍵列之原物件仍被寫入稽核欄位(既有行為鎖定)(F04)', async function() {
        //規則7; 修前: adjustData 以賦值寫入稽核欄位, 類別DTO之原型setter在跨段同鍵檢查之後被執行, 可改寫id(使檢查所見之id不同於實際寫入者)並向列加入含自有__proto__之欄位
        let keys = ['id', 'name', 'meta', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate']
        let dsA = {
            str: { tests: { keys, settings: { id: { pk: true, type: 'STRING' }, name: { type: 'STRING' } } } },
            unknown: { tests: { keys } },
            int: { tests: { keys, settings: { id: { pk: true, type: 'INTEGER' }, name: { type: 'STRING' } } } },
        }
        let reads = 0
        class Dto {
            constructor(id) {
                this.id = id
                this.name = 'n'
                this.meta = {}
            }

            set userIdUpdate(v) { // eslint-disable-line accessor-pairs
                reads++
                this.id = 'keep'
                Object.defineProperty(this.meta, '__proto__', { value: { unchecked: 1 }, enumerable: true, configurable: true, writable: true })
            }
        }
        for (let kind of KINDS) {
            let proc = WServOrm(dsA[kind], WOrmStub, 'u', 'd').procOrm
            for (let entry of ['insert', 'save', 'mix.add', 'mix.diff']) {
                stub.reset()
                let row = new Dto('new')
                await quiet(() => runW(proc, entry, row))
                assert.strictEqual(calls.length, 1, `${kind} ${entry}`)
                assert.strictEqual(reads, 0, `${kind} ${entry} 原型setter不被執行`)
                let got = firstRow()
                assert.strictEqual(got.id, 'new', `${kind} ${entry} id不被改寫`)
                assert.ok(!hasOwn(got.meta, '__proto__'), `${kind} ${entry} 無未檢查之欄位`)
                assert.strictEqual(got.userIdUpdate, 'u1', `${kind} ${entry} 稽核欄位已寫入`)
                assert.ok(typeof got.timeUpdate === 'string' && got.timeUpdate.length > 0, `${kind} ${entry} timeUpdate`)
            }
            //凍結之列: 寫入稽核欄位拋TypeError, 轉為固定字串
            stub.reset()
            assert.strictEqual(await rjS(proc, 'insert', [Object.freeze({ id: 'a', name: 'n' })]), 'failed to adjust data', `${kind} 凍結列`)
            assert.deepStrictEqual(calls, [], `${kind} 凍結列 ORM不應被呼叫`)
        }
        //既有行為鎖定(帳本 R-OBJ-01 已知限制): 字串主鍵之列(未經轉型複製)其原物件被寫入稽核欄位
        let procS = WServOrm(dsA.str, WOrmStub, 'u', 'd').procOrm
        let own = { id: 'a1', name: 'n' }
        await quiet(() => procS('u1', 'tests', 'insert', [own]))
        assert.strictEqual(own.userId, 'u1', '原物件被寫入稽核欄位(既有行為)')
    })

    it('S12 存取器之判準以描述子有無value欄位為準: get與set皆為undefined之存取器id/欄位仍視為存取器(寫入列與find整批reject, mix.del列整批reject)(F07)', async function() {
        //規則3、7; 修前: 以 d.get !== undefined || d.set !== undefined 判斷, 漏掉 { get: undefined, set: undefined }
        let emptyAcc = (o, k, enumerable = true) => Object.defineProperty(o, k, { get: undefined, set: undefined, enumerable, configurable: true })
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            for (let entry of ['insert', 'save', 'mix.add', 'mix.diff']) {
                stub.reset()
                assert.strictEqual(await quiet(() => getReject(runW(proc, entry, emptyAcc({ name: 'x' }, 'id')))), `${msgWrite[entry]}, unsupported accessor property: data[0]`, `${kind} ${entry} id`)
                assert.strictEqual(await quiet(() => getReject(runW(proc, entry, emptyAcc({ id: 'a1' }, 'name')))), `${msgWrite[entry]}, unsupported accessor property: data[0]`, `${kind} ${entry} 欄位`)
                assert.deepStrictEqual(calls, [], `${kind} ${entry} ORM不應被呼叫`)
            }
            for (let enumerable of [true, false]) {
                stub.reset()
                assert.strictEqual(await quiet(() => getReject(proc('u1', 'tests', 'mix', { add: [{ id: 'a1' }], del: [emptyAcc({}, 'id', enumerable)] }))), `failed to delete data, ${IRREG}: data[0]`, `${kind} mix.del enumerable=${enumerable}`)
                assert.deepStrictEqual(calls, [], `${kind} mix.del ORM不應被呼叫`)
            }
            for (let mode of ['select', 'delAll']) {
                assert.strictEqual(await rjS(proc, mode, emptyAcc({}, 'name')), `invalid find of ${mode}, unsupported accessor property`, `${kind} ${mode}`)
            }
            //不可列舉之空存取器id(寫入列): 與不可列舉之存取器同, 視為未提供
            stub.reset()
            await quiet(() => proc('u1', 'tests', 'insert', [emptyAcc({ name: 'x' }, 'id', false)]))
            assert.strictEqual(calls.length, 1, `${kind} 不可列舉之空存取器id視為未提供`)
            assert.ok(!hasOwn(firstRow(), 'id') || isGen(firstRow().id), `${kind} 補主鍵或無id`)
        }
    })

    it('S13 原型鏈長度上限(MAX_CHAIN: 鏈上至多65個物件含自身): 共用陣列帶長原型鏈而被引用多次時分類成本有界; 恰在上限通過、逾1層以irregular拒收(F08)', async function() {
        //規則5續、6; 修前: measureFind 對每條邊重新分類而重掃原型鏈, E 條邊 x P 層原型為平方; 現鏈長逾上限者視為不乾淨
        let withChain = (arr, k) => {
            //arr -> p1 -> ... -> pk -> Array.prototype -> Object.prototype -> null; 鏈上物件數 = 1 + k + 2
            let top = Array.prototype
            for (let i = 0; i < k; i++) {
                top = Object.create(top)
            }
            return Object.setPrototypeOf(arr, top)
        }
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                let L = `${kind} ${mode}`
                stub.reset()
                await quiet(() => proc('u1', 'tests', mode, { id: { $in: withChain([], 61) } })) //鏈上64個物件
                assert.strictEqual(calls.length, 1, `${L} 鏈上64個物件通過`)
                stub.reset()
                await quiet(() => proc('u1', 'tests', mode, { id: { $in: withChain([], 62) } })) //65個(上限)
                assert.strictEqual(calls.length, 1, `${L} 鏈上65個物件通過(上限)`)
                stub.reset()
                assert.strictEqual(await rjS(proc, mode, { id: { $in: withChain([], 63) } }), `invalid find of ${mode}, ${IRREG}`, `${L} 鏈上66個物件`)
                assert.strictEqual(calls.length, 0, `${L} ORM不應被呼叫`)
                //極長之鏈: 不逐層走完(成本有界)
                let t = Date.now()
                stub.reset()
                assert.strictEqual(await rjS(proc, mode, { id: { $in: withChain([], 200000) } }), `invalid find of ${mode}, ${IRREG}`, `${L} 20萬層`)
                assert.ok(Date.now() - t < 1000, `${L} 20萬層耗時 ${Date.now() - t} ms`)
                //共用之長鏈陣列被引用多次(E x P 有界)
                let shared = withChain([], 62)
                t = Date.now()
                stub.reset()
                await quiet(() => proc('u1', 'tests', mode, { $or: Array.from({ length: 20000 }, () => shared) }))
                assert.strictEqual(calls.length, 1, `${L} 共用長鏈陣列2萬次通過`)
                assert.ok(Date.now() - t < 3000, `${L} 共用長鏈陣列2萬次耗時 ${Date.now() - t} ms`)
            }
        }
    })

    it('S15 mix之input本身: Proxy(含已撤銷者)、原型鏈有標籤者於讀取任何屬性之前整批reject, 陷阱0次; add、del、diff只取input之自有資料屬性(繼承者不取、不執行原型上之getter)(minimax F3)', async function() {
        //規則7、R-INPUT-01 規則2; 修前: iseobj(input)讀標籤、input.add讀屬性, 對Proxy執行陷阱8次, 對繼承之存取器執行原型上之getter
        let reads = 0
        let counted = (target) => new Proxy(target, {
            get(t, k, r) {
                reads++
                return Reflect.get(t, k, r)
            },
            has(t, k) {
                reads++
                return Reflect.has(t, k)
            },
            ownKeys(t) {
                reads++
                return Reflect.ownKeys(t)
            },
            getOwnPropertyDescriptor(t, k) {
                reads++
                return Reflect.getOwnPropertyDescriptor(t, k)
            },
        })
        let revoked = () => {
            let rv = Proxy.revocable({ add: [okRow()] }, {})
            rv.revoke()
            return rv.proxy
        }
        let NEED = 'invalid input of mix, need the result object of ltdtDiffByKey'
        for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
            for (let [lab, mk] of [
                ['Proxy', () => counted({ add: [okRow()] })],
                ['已撤銷之Proxy', revoked],
                ['原型鏈有標籤', () => Object.assign(Object.create(Object.assign(Object.create(null), { [Symbol.toStringTag]: 'X' })), { add: [okRow()] })],
                ['自有標籤', () => ({ add: [okRow()], [Symbol.toStringTag]: 'X' })],
            ]) {
                stub.reset()
                assert.strictEqual(await rjS(proc, 'mix', mk()), NEED, `${kind} ${lab}`)
                assert.deepStrictEqual(calls, [], `${kind} ${lab} ORM不應被呼叫`)
            }
            assert.strictEqual(reads, 0, `${kind} 陷阱不被執行`)
            //繼承之存取器add: 不取(原型上之getter不被執行); 無自有add、del、diff者為無操作
            let inheritedReads = 0
            class MixIn {
                get add() {
                    inheritedReads++
                    return [okRow()]
                }
            }
            let mi = Object.assign(new MixIn(), { diff: [{ id: 'f1', name: 'd' }] })
            stub.reset()
            await quiet(() => proc('u1', 'tests', 'mix', mi))
            assert.strictEqual(inheritedReads, 0, `${kind} 原型上之getter不被執行`)
            assert.deepStrictEqual(calls.map((v) => v.fn), ['save'], `${kind} 只處理自有之diff`)
            //對照: 類別實例而add、del、diff為自有資料屬性者照常
            class Plain {
                constructor() {
                    this.add = [{ id: 'n1', name: 'a' }]
                }
            }
            stub.reset()
            await quiet(() => proc('u1', 'tests', 'mix', new Plain()))
            assert.deepStrictEqual(calls.map((v) => v.fn), ['insert'], `${kind} 類別實例照常`)
        }
    })

    it('S14 被拒之批次容器與列再被呼叫端重用: 診斷輸出(真格式化, 非quiet)不執行inspect.custom與標籤getter, 同一物件第二次呼叫仍同結果, 物件不被改動(F09)', async function() {
        //規則7、R-OBJ-01 規則6 ⑤ 延伸至寫入路徑; 修前若拒收路徑 console.log 原物件(util.inspect 讀標籤並呼叫 inspect.custom), 其副作用可在拒收後改動呼叫端物件
        let reads = 0
        let withProbe = (o) => {
            o[util.inspect.custom] = () => {
                reads++
                return 'x'
            }
            return o
        }
        let items = [
            ['原型鏈有標籤getter之陣列(容器)', 'container', () => withProbe(Object.setPrototypeOf([okRow()], Object.create(Array.prototype, {
                [Symbol.toStringTag]: {
                    get() {
                        reads++
                        return 'Array'
                    },
                },
            })))],
            ['有空洞之陣列(容器)', 'container', () => withProbe(Object.assign([okRow(), , okRow()], { extra: 1 }))], // eslint-disable-line no-sparse-arrays
            ['索引為存取器之陣列(容器)', 'container', () => withProbe(Object.defineProperty([okRow()], 0, {
                enumerable: true,
                get() {
                    reads++
                    return okRow()
                },
            }))],
            ['帶標籤與inspect之列', 'row', () => withProbe({ id: 'a1', [Symbol.toStringTag]: 'X' })],
        ]
        let logOrig = console.log
        console.log = (...a) => {
            util.format(...a) //同真 console.log 格式化引數後丟棄(不用 quiet: 其不格式化引數而測不出)
        }
        let done = 0
        try {
            for (let { kind, proc } of getKinds().filter((v) => KINDS.includes(v.kind))) {
                for (let [lab, type, mk] of items) {
                    let modes = type === 'container' ? ['insert', 'save', 'del', 'mix.add', 'mix.del', 'mix.diff'] : ['insert', 'save', 'mix.add', 'mix.diff']
                    for (let mode of modes) {
                        let obj = mk()
                        let n = Reflect.ownKeys(obj).length
                        let input = () => {
                            if (mode.startsWith('mix.')) {
                                return { [mode.slice(4)]: type === 'container' ? obj : [obj] }
                            }
                            return type === 'container' ? obj : [obj]
                        }
                        let call = () => proc('u1', 'tests', mode.startsWith('mix.') ? 'mix' : mode, input())
                        let r1 = await getReject(call())
                        let r2 = await getReject(call())
                        assert.strictEqual(typeof r1, 'string', `${kind} ${lab} ${mode} 第1次`)
                        assert.strictEqual(r2, r1, `${kind} ${lab} ${mode} 同一物件第2次同結果`)
                        assert.strictEqual(Reflect.ownKeys(obj).length, n, `${kind} ${lab} ${mode} 物件未被改動`)
                        done++
                    }
                    assert.strictEqual(reads, 0, `${kind} ${lab} 診斷輸出與檢查不執行使用端程式`)
                }
            }
        }
        finally {
            console.log = logOrig
        }
        assert.strictEqual(done, 3 * (3 * 6 + 4), '完成數')
    })

})
