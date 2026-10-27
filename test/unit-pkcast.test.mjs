import assert from 'assert'
import WServOrm from '../src/WServOrm.mjs'
import getMapOrm from '../src/getMapOrm.mjs'


//替身ORM: 記錄收到之數據, 回傳形狀依w-orm系列規格(save、del回逐筆陣列, insert與delAll回聚合物件); plan可覆寫各函數之回傳
let calls = []
let plan = {}
function WOrmStub() {
    let ev = {}
    for (let fn of ['select', 'insert', 'save', 'del', 'delAll']) {
        ev[fn] = async (data) => {
            calls.push({ fn, data })
            if (plan[fn]) {
                return plan[fn](data)
            }
            if (fn === 'select') {
                return []
            }
            if (fn === 'save') {
                return (Array.isArray(data) ? data : [data]).map(() => ({ n: 1, nInserted: 0, nModified: 1, ok: 1 }))
            }
            if (fn === 'del') {
                return (Array.isArray(data) ? data : [data]).map(() => ({ n: 1, nDeleted: 1, ok: 1 }))
            }
            if (fn === 'delAll') {
                return { n: 0, nDeleted: 0, ok: 1 }
            }
            return { n: 1, nInserted: 1, ok: 1 }
        }
    }
    return ev
}

let dsStr = { tests: { keys: ['id', 'name'], settings: { id: { pk: true, type: 'STRING' }, name: { type: 'STRING' } } } }
let dsUnknown = { tests: { keys: ['id', 'name'] } }
let dsInt = { tests: { keys: ['id', 'name'], settings: { id: { pk: true, type: 'INTEGER' }, name: { type: 'STRING' } } } }
let dsAudit = { tests: { keys: ['id', 'name', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate'] } }
let isGen = (v) => typeof v === 'string' && v.length > 30
let idOf = (d) => (Array.isArray(d) ? d[0].id : d.id)
let wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function getReject(pm) {
    try {
        await pm
    }
    catch (err) {
        return err
    }
    throw new Error('預期reject但resolve')
}

async function quiet(fn) {
    let logOrig = console.log
    console.log = () => {}
    try {
        return await fn()
    }
    finally {
        console.log = logOrig
    }
}


describe('R-ID-02 字串型主鍵欄之數字主鍵以字串處置', function() {

    beforeEach(function() {
        calls = []
        plan = {}
    })

    it('N01 寫入六入口之有限數字主鍵轉為字串並回報之, 呼叫端物件不變', async function() {
        //R-ID-02 規則1(字串型或型別未知)、規則2(寫入)、規則4(複本)
        for (let ds of [dsStr, dsUnknown]) {
            let so = WServOrm(ds, WOrmStub, 'u', 'd')
            for (let n of [123, 0, -5, 1.5]) {
                calls = []
                let a = { id: n, name: 'a' }
                let rs = [
                    await so.procOrm('u1', 'tests', 'insert', [a]),
                    await so.procOrm('u1', 'tests', 'insert', a),
                    await so.procOrm('u1', 'tests', 'save', [a]),
                    await so.procOrm('u1', 'tests', 'save', a),
                    await so.procOrm('u1', 'tests', 'mix', { add: [a] }),
                    await so.procOrm('u1', 'tests', 'mix', { diff: [a] }),
                ]
                let s = String(n)
                assert.deepStrictEqual(calls.map((c) => idOf(c.data)), [s, s, s, s, s, s], JSON.stringify(ds))
                assert.deepStrictEqual(rs.map((r) => idOf(r)), [s, s, s, s, s, s])
                assert.strictEqual(a.id, n)
            }
        }
    })

    it('N02 刪除三入口之數字主鍵轉為字串, 逐筆失敗之訊息照列', async function() {
        //R-ID-02 規則2(刪除; mix回報之del列為轉型後之值); R-MSG-01 規則3
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        await so.procOrm('u1', 'tests', 'del', [{ id: 123 }, { id: 'x' }])
        await so.procOrm('u1', 'tests', 'del', { id: 7 })
        let r = await so.procOrm('u1', 'tests', 'mix', { del: [{ id: 8 }] })
        assert.deepStrictEqual(calls.map((c) => c.data), [[{ id: '123' }, { id: 'x' }], { id: '7' }, [{ id: '8' }]])
        assert.deepStrictEqual(r, [{ id: '8' }])
        plan.del = (data) => data.map((v, k) => (k === 0 ? { n: 1, nDeleted: 0, ok: 0, err: 'E-del' } : { n: 1, nDeleted: 1, ok: 1 }))
        let err = await quiet(() => getReject(so.procOrm('u1', 'tests', 'del', [{ id: 123 }, { id: 'y' }])))
        assert.strictEqual(err, 'failed to delete data: id[123]')
    })

    it('N03 查詢條件之白名單內比較運算子(含$and、$or巢狀)轉型, 他欄與其餘運算子不變, 呼叫端條件不變', async function() {
        //R-ID-02 規則2(查詢條件)、規則4; R-WL-01 規則3(轉型範圍只及系列白名單: $eq $ne $gt $gte $lt $lte $in $nin, 文件層$and $or)
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        let finds = [
            { id: 123 },
            { id: { $eq: 1, $ne: 2, $gt: 3, $gte: 4, $lt: 5, $lte: 6 } },
            { id: { $in: [7, 'a'], $nin: [8] } },
            { $or: [{ id: 13 }, { name: 'x' }], $and: [{ id: { $in: [14] } }] },
            { $and: [{ $or: [{ id: 16 }] }] },
            { name: 17, id: { $regex: '^a', $exists: true } },
            { id: { $eq: [9], $ne: [10, 'b'], $gt: [11], $gte: [12], $lt: [13], $lte: [14] } }, //比較運算子之值為陣列者逐一轉型(替身ORM; 真後端對 $in、$nin 以外之陣列值本就reject)
        ]
        let findsCopy = JSON.parse(JSON.stringify(finds))
        for (let f of finds) {
            await so.procOrm('u1', 'tests', 'select', f)
        }
        await so.procOrm('u1', 'tests', 'delAll', { id: 18 })
        await so.procOrm('u1', 'tests', 'delAll', { id: { $in: [19] } })
        assert.deepStrictEqual(calls.map((c) => c.data), [
            { id: '123' },
            { id: { $eq: '1', $ne: '2', $gt: '3', $gte: '4', $lt: '5', $lte: '6' } },
            { id: { $in: ['7', 'a'], $nin: ['8'] } },
            { $or: [{ id: '13' }, { name: 'x' }], $and: [{ id: { $in: ['14'] } }] },
            { $and: [{ $or: [{ id: '16' }] }] },
            { name: 17, id: { $regex: '^a', $exists: true } },
            { id: { $eq: ['9'], $ne: ['10', 'b'], $gt: ['11'], $gte: ['12'], $lt: ['13'], $lte: ['14'] } },
            { id: '18' },
            { id: { $in: ['19'] } },
        ])
        assert.deepStrictEqual(finds, findsCopy)
    })

    it('N04 主鍵欄為整數型者各入口皆不轉型亦不補值', async function() {
        //R-ID-02 規則1; R-ID-01 規則1(整數型不補值)
        let so = WServOrm(dsInt, WOrmStub, 'u', 'd')
        let r = await so.procOrm('u1', 'tests', 'insert', [{ id: 123 }, { name: 'a' }])
        await so.procOrm('u1', 'tests', 'del', [{ id: 5 }])
        await so.procOrm('u1', 'tests', 'select', { id: 5 })
        await so.procOrm('u1', 'tests', 'delAll', { id: { $in: [6] } })
        await so.procOrm('u1', 'tests', 'mix', { diff: [{ id: 7, name: 'b' }] })
        assert.deepStrictEqual(calls[0].data.map((v) => v.id), [123, undefined])
        assert.deepStrictEqual(r.map((v) => v.id), [123, undefined])
        assert.deepStrictEqual(calls.slice(1).map((c) => c.data), [[{ id: 5 }], { id: 5 }, { id: { $in: [6] } }, [{ id: 7, name: 'b' }]])
    })

    it('N05 NaN與正負Infinity視為未提供: 寫入補值且回報一致, 刪除與查詢原樣', async function() {
        //R-ID-02 規則3; R-ID-01 規則1
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        let r = await so.procOrm('u1', 'tests', 'insert', [{ id: NaN }, { id: Infinity }, { id: -Infinity }])
        let got = calls[0].data.map((v) => v.id)
        assert.ok(got.every(isGen), JSON.stringify(got))
        assert.deepStrictEqual(r.map((v) => v.id), got)
        await so.procOrm('u1', 'tests', 'del', [{ id: Infinity }])
        await so.procOrm('u1', 'tests', 'select', { id: NaN })
        assert.deepStrictEqual(calls[1].data, [{ id: Infinity }])
        assert.deepStrictEqual(calls[2].data, { id: NaN })
    })

    it('N06 同批之數字與其字串形式為同一字串主鍵', async function() {
        //R-ID-02 規則2: 後端依同批重複處置, 本套件回報兩筆同鍵(insert回傳之id含被略過者)
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        let r = await so.procOrm('u1', 'tests', 'insert', [{ id: 1 }, { id: '1' }])
        assert.deepStrictEqual(calls[0].data.map((v) => v.id), ['1', '1'])
        assert.deepStrictEqual(r, [{ id: '1' }, { id: '1' }])
    })

    it('N07 ds無該表者select與del不拋錯且原樣交ORM', async function() {
        //R-ID-02 規則1: 直接呼叫getMapOrm而ds與woItems不一致者不轉型
        let procOrm = getMapOrm({ others: dsStr.tests }, { tests: WOrmStub() })
        await procOrm('u1', 'tests', 'select', { id: 123 })
        await procOrm('u1', 'tests', 'del', [{ id: 123 }])
        await procOrm('u1', 'tests', 'delAll', { id: 123 })
        assert.deepStrictEqual(calls.map((c) => c.data), [{ id: 123 }, [{ id: 123 }], { id: 123 }])
    })

    it('N08 型別字串去參數後比對: STRING(36)視為字串型而補值與轉型', async function() {
        //R-ID-01 規則1(取「(」之前之字並轉大寫); R-ID-02 規則1
        let cases = [
            ['STRING(36)', true],
            ['string(36)', true],
            ['TEXT', true],
            ['INTEGER', false],
            ['INTEGER(11)', false],
        ]
        for (let [type, expect] of cases) {
            calls = []
            let ds = { tests: { keys: ['id', 'name'], settings: { id: { pk: true, type }, name: { type: 'STRING' } } } }
            let so = WServOrm(ds, WOrmStub, 'u', 'd')
            await so.procOrm('u1', 'tests', 'insert', [{ name: 'a' }, { id: 5 }])
            let got = calls[0].data.map((v) => v.id)
            assert.strictEqual(isGen(got[0]), expect, type)
            assert.strictEqual(got[1], expect ? '5' : 5, type)
        }
    })

    it('N09 後處理之input為前處理後之input(主鍵不轉型), output為轉型後之回報', async function() {
        //R-ID-02 規則5; R-HOOK-01 規則5
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        let seen = []
        so.addFunPreProcessing(({ input }) => ({ input: [...input, { id: 2, name: 'pre' }] }))
        so.addFunPostProcessing(({ input, output }) => {
            seen.push({ input, output })
            return output
        })
        await wait(20)
        let r = await so.procOrm('u1', 'tests', 'insert', [{ id: 1, name: 'a' }])
        assert.deepStrictEqual(seen[0].input, [{ id: 1, name: 'a' }, { id: 2, name: 'pre' }])
        assert.deepStrictEqual(seen[0].output, [{ id: '1' }, { id: '2' }])
        assert.deepStrictEqual(r, [{ id: '1' }, { id: '2' }])
    })

    it('N10 系列白名單外之$not、$all、$nor及其內之id原樣交ORM而不轉型, 白名單由後端把關', async function() {
        //R-WL-01 規則2、3: 本套件不依運算子名稱放行或攔截, 也不轉型白名單外運算子內之id; 還原$not、$all、$nor之轉型分支(死碼)則本案轉紅
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        let finds = [
            { id: { $not: { $eq: 10 } } },
            { id: { $not: { $in: [11, 12] } } },
            { id: { $in: [7], $all: [9] } },
            { $nor: [{ id: 15 }] },
            { $or: [{ id: 13 }, { $nor: [{ id: 15 }] }], $and: [{ id: { $not: { $eq: 10 } } }] },
        ]
        let findsCopy = JSON.parse(JSON.stringify(finds))
        let expected = [
            { id: { $not: { $eq: 10 } } },
            { id: { $not: { $in: [11, 12] } } },
            { id: { $in: ['7'], $all: [9] } }, //同條件物件內之白名單運算子($in)仍轉型
            { $nor: [{ id: 15 }] },
            { $or: [{ id: '13' }, { $nor: [{ id: 15 }] }], $and: [{ id: { $not: { $eq: 10 } } }] },
        ]
        for (let mode of ['select', 'delAll']) {
            calls = []
            for (let f of finds) {
                await so.procOrm('u1', 'tests', mode, f)
            }
            assert.deepStrictEqual(calls.map((c) => c.fn), finds.map(() => mode))
            assert.deepStrictEqual(calls.map((c) => c.data), expected, mode)
        }
        assert.deepStrictEqual(finds, findsCopy)
    })

    it('N11 ORM以reject拒絕條件: select以failed to select data、delAll以failed to delete data固定字串回傳, ORM原文只進log(opt.logDetail為true時, R-DIAG-01)', async function() {
        //R-WL-01 規則4; R-ERR-01 規則1: 後端(白名單)拒絕時之錯誤回傳路徑, ORM之reject為Error物件或字串皆然; 診斷輸出預設不含原文, 此處以logDetail為true取得
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd', { logDetail: true })
        let find = { id: { $not: { $eq: 5 } } }
        for (let orig of [new Error('invalid find: unsupported operator [$not] at [find.id.$not]'), 'invalid find: unsupported operator [$not] at [find.id.$not]']) {
            for (let [mode, msg] of [['select', 'failed to select data'], ['delAll', 'failed to delete data']]) {
                calls = []
                plan = { [mode]: () => Promise.reject(orig) }
                let logs = []
                let logOrig = console.log
                console.log = (...args) => logs.push(args)
                let err
                try {
                    err = await getReject(so.procOrm('u1', 'tests', mode, find))
                }
                finally {
                    console.log = logOrig
                }
                assert.strictEqual(err, msg, mode)
                assert.strictEqual(calls.length, 1, `${mode} ORM被呼叫一次`)
                assert.ok(logs.some((a) => a.includes(orig)), `${mode} ORM原文進log`)
            }
        }
    })

})


describe('R-MIX-01 mix之跨段同鍵整批拒絕', function() {

    beforeEach(function() {
        calls = []
        plan = {}
    })

    it('M01 add與del、del與diff正規化後同鍵者整批reject且ORM未被呼叫, add與diff同鍵照常', async function() {
        //R-MIX-01 規則1-4
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        let mix = (input) => quiet(() => getReject(so.procOrm('u1', 'tests', 'mix', input)))
        assert.strictEqual(await mix({ add: [{ id: 123 }], del: [{ id: '123' }] }), 'invalid input of mix, same id in add and del: add[0], del[0]')
        assert.strictEqual(await mix({ add: [{ id: 'a' }, { id: 'x' }], del: [{ id: 'b' }, { id: 'a' }] }), 'invalid input of mix, same id in add and del: add[0], del[1]')
        assert.strictEqual(await mix({ del: [{ id: 'b' }], diff: [{ id: 'c' }, { id: 'b' }] }), 'invalid input of mix, same id in del and diff: del[0], diff[1]')
        assert.strictEqual(await mix({ add: [{ id: 'a' }], del: [{ id: 'a' }, { id: 'b' }], diff: [{ id: 'b' }] }), 'invalid input of mix, same id in add and del: add[0], del[0]; invalid input of mix, same id in del and diff: del[1], diff[0]')
        assert.deepStrictEqual(calls, [])

        //未提供主鍵者不參與比對; add與diff同鍵照常(insert略過、save更新, 不遺失)
        await so.procOrm('u1', 'tests', 'mix', { add: [{ name: 'x' }], del: [{ name: 'y' }], diff: [{ name: 'z' }] })
        await so.procOrm('u1', 'tests', 'mix', { add: [{ id: 'c' }], diff: [{ id: 'c' }] })
        assert.deepStrictEqual(calls.map((v) => v.fn), ['insert', 'del', 'save', 'insert', 'save'])

        //整數主鍵欄之5與'5'亦視為同鍵
        calls = []
        let si = WServOrm(dsInt, WOrmStub, 'u', 'd')
        let err = await quiet(() => getReject(si.procOrm('u1', 'tests', 'mix', { add: [{ id: 5 }], del: [{ id: '5' }] })))
        assert.strictEqual(err, 'invalid input of mix, same id in add and del: add[0], del[0]')
        assert.deepStrictEqual(calls, [])
    })

})


describe('R-INPUT-01 寫入與delAll之輸入形狀', function() {

    beforeEach(function() {
        calls = []
        plan = {}
    })

    it('E01 insert、save、mix之新增與修改之元素非一般物件即整批reject且ORM未被呼叫', async function() {
        //R-INPUT-01 規則1、2; 有稽核欄位者原為failed to adjust data, 無者原寫入垃圾紀錄
        for (let ds of [dsUnknown, dsAudit]) {
            let so = WServOrm(ds, WOrmStub, 'u', 'd')
            let rj = (mode, input) => quiet(() => getReject(so.procOrm('u1', 'tests', mode, input)))
            for (let bad of ['abc', ['a', 'b'], 5, null, true, new Date('2026-01-01T00:00:00Z')]) {
                assert.strictEqual(await rj('insert', [bad]), 'failed to insert data, not an object: data[0]', String(bad))
                assert.strictEqual(await rj('save', [{ id: 'a' }, bad]), 'failed to save data, not an object: data[1]', String(bad))
                assert.strictEqual(await rj('mix', { add: [bad] }), 'failed to insert data, not an object: data[0]', String(bad))
                assert.strictEqual(await rj('mix', { diff: [{ id: 'b' }, bad] }), 'failed to update data, not an object: data[1]', String(bad))
            }
            assert.strictEqual(await rj('insert', 'abc'), 'failed to insert data, not an object: data[0]')
            assert.strictEqual(await rj('save', 5), 'failed to save data, not an object: data[0]')
            assert.strictEqual(await rj('insert', null), 'failed to insert data, not an object: data[0]')
            assert.strictEqual(await rj('insert', undefined), 'failed to insert data, not an object: data[0]')
            assert.strictEqual(await rj('insert', [{ id: 'a' }, 'x', 5]), 'failed to insert data, not an object: data[1], data[2]')
            assert.strictEqual(await rj('mix', { add: ['x'], diff: [5] }), 'failed to insert data, not an object: data[0]; failed to update data, not an object: data[0]')
            assert.deepStrictEqual(calls, [])
        }
    })

    it('E02 mix之add、del、diff給予而非陣列即reject且ORM未被呼叫', async function() {
        //R-INPUT-01 規則2
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        let msg = 'invalid input of mix, need the result object of ltdtDiffByKey'
        for (let input of [{ add: { id: 'a' } }, { del: { id: 'a' } }, { diff: { id: 'a' } }, { add: null }, { del: 'a' }, { add: [], diff: 5 }]) {
            assert.strictEqual(await quiet(() => getReject(so.procOrm('u1', 'tests', 'mix', input))), msg, JSON.stringify(input))
        }
        assert.deepStrictEqual(calls, [])
        let r = await so.procOrm('u1', 'tests', 'mix', { add: [], del: [], diff: [] })
        assert.deepStrictEqual(r, [])
    })

    it('E03 delAll之find非物件即reject且ORM未被呼叫, undefined與物件照常', async function() {
        //R-INPUT-01 規則3
        let so = WServOrm(dsStr, WOrmStub, 'u', 'd')
        for (let find of [[], ['a'], 'a', null, 5, true]) {
            assert.strictEqual(await quiet(() => getReject(so.procOrm('u1', 'tests', 'delAll', find))), 'invalid find of delAll, need an object', JSON.stringify(find))
        }
        assert.deepStrictEqual(calls, [])
        await so.procOrm('u1', 'tests', 'delAll', undefined)
        await so.procOrm('u1', 'tests', 'delAll', {})
        await so.procOrm('u1', 'tests', 'delAll', { name: 'x' })
        assert.deepStrictEqual(calls.map((c) => c.data), [undefined, {}, { name: 'x' }])
    })

    it('E04 多筆批次之空物件列補值且回報與ORM收到者一致, 單筆空物件維持原樣', async function() {
        //R-ID-01 規則3(裁示D5)
        let so = WServOrm(dsUnknown, WOrmStub, 'u', 'd')
        let r1 = await so.procOrm('u1', 'tests', 'insert', [{}, { name: 'x' }])
        let r2 = await so.procOrm('u1', 'tests', 'save', [{}, {}])
        let r3 = await so.procOrm('u1', 'tests', 'insert', [{}])
        let r4 = await so.procOrm('u1', 'tests', 'insert', {})
        assert.ok(calls[0].data.every((v) => isGen(v.id)) && calls[1].data.every((v) => isGen(v.id)))
        assert.deepStrictEqual(r1.map((v) => v.id), calls[0].data.map((v) => v.id))
        assert.deepStrictEqual(r2.map((v) => v.id), calls[1].data.map((v) => v.id))
        assert.deepStrictEqual(calls[2].data, [{}])
        assert.deepStrictEqual(calls[3].data, {})
        assert.deepStrictEqual([r3, r4], [[{ id: undefined }], { id: undefined }])
    })

})
