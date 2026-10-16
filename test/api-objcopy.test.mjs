import fs from 'fs'
import assert from 'assert'
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs'
import WServOrm from '../src/WServOrm.mjs'
import { getReject, quiet, same } from './tools/ormStub.mjs'


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

//refMatch, JS參考實作: 欄位等值(嚴格相等)、$and、$or、$nor、欄位層$in/$nin/$eq/$ne/$not; 缺欄視為undefined
function refMatch(row, find) {
    let opMatch = (v, c) => {
        if (c !== null && typeof c === 'object' && !Array.isArray(c)) {
            return Object.keys(c).every((op) => {
                if (op === '$eq') return v === c[op]
                if (op === '$ne') return v !== c[op]
                if (op === '$in') return c[op].includes(v)
                if (op === '$nin') return !c[op].includes(v)
                if (op === '$not') return !opMatch(v, c[op])
                throw new Error(`參考實作不支援${op}`)
            })
        }
        return v === c
    }
    return Object.keys(find).every((k) => {
        let c = find[k]
        if (k === '$and') return c.every((f) => refMatch(row, f))
        if (k === '$or') return c.some((f) => refMatch(row, f))
        if (k === '$nor') return !c.some((f) => refMatch(row, f))
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
    { $nor: [{ length: 3 }] },
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

})
