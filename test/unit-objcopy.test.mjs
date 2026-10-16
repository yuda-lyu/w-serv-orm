import assert from 'assert'
import vm from 'vm'
import util from 'util'
import WServOrm from '../src/WServOrm.mjs'
import getMapOrm from '../src/getMapOrm.mjs'
import { createStub, getReject, quiet, same } from './tools/ormStub.mjs'


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
        [{ $and: [{ length: 1, name: 'x' }], $or: [{ length: 2 }, { id: 7, length: 1 }], $nor: [{ id: 'z', length: 3 }] }, { $and: [{ length: 1, name: 'x' }], $or: [{ length: 2 }, { id: '7', length: 1 }], $nor: [{ id: 'z', length: 3 }] }],
        [{ id: { length: 2, $in: [1, 2] } }, { id: { length: 2, $in: ['1', '2'] } }],
        [{ id: { $not: { length: 1, $eq: 9 } } }, { id: { $not: { length: 1, $eq: '9' } } }],
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
            ['已撤銷之Proxy', () => revoked.proxy, 'unreadable value'],
            ['ownKeys陷阱拋錯', () => new Proxy({}, {
                ownKeys() {
                    throw new Error('SECRET-TRAP')
                }
            }), 'unreadable value'],
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

    it('P05 陣列本身含自有__proto__鍵(不論可否列舉)亦reject; 稀疏陣列之空洞照常', async function() {
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

            //稀疏陣列之空洞: 無屬性描述子, 不視為不支援
            let sparse = [1, , 3] // eslint-disable-line no-sparse-arrays
            await proc('u1', 'tests', 'select', { id: { $in: sparse } })
            assert.strictEqual(calls.length, 1, `${kind} 稀疏陣列之條件照常交ORM`)
            stub.reset()
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

    it('P07 偽造Symbol.toStringTag為Array之物件不當陣列走訪: 不呼叫其length getter', async function() {
        //R-OBJ-01 規則3(陣列之判定用Array.isArray): isarr以Object.prototype.toString判定可被偽造, 走訪時讀其length(外審 opus 二輪 F6)
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
                await proc('u1', 'tests', mode, { name: { $eq: fake } })
            }
            assert.strictEqual(reads, 0, `${kind} length getter不應被呼叫`)
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
        let find = { $or: [{ id: { $in: [1, 2] } }, { $and: [{ name: 'x' }, { $nor: [{ name: 'y' }, { id: { $not: { $eq: 3 } } }] }] }] }
        for (let { kind, proc } of getKinds()) {
            for (let mode of ['select', 'delAll']) {
                stub.reset()
                await proc('u1', 'tests', mode, find)
                assert.strictEqual(calls.length, 1, `${kind} ${mode}`)
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

    it('C04 循環或鏈狀共用子結構之find使遞迴爆堆疊: 以固定字串reject(字串型主鍵表; 其餘表型態原樣交ORM)', async function() {
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
                    if (cast) {
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
