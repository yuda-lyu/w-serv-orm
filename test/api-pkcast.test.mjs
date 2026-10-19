import fs from 'fs'
import assert from 'assert'
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs'
import ltdtDiffByKey from 'wsemi/src/ltdtDiffByKey.mjs'
import ds from '../schema/index.mjs'
import WServOrm from '../src/WServOrm.mjs'


//以真ORM(w-orm-lowdb, 主鍵固定為字串id, 數字主鍵原會被其以genIDSeq取代)經procOrm驗證R-ID-02、R-MIX-01; schema之tests表之id為STRING pk
let fd = './test/_tmp/api-pkcast'

async function getReject(pm) {
    try {
        await pm
    }
    catch (err) {
        return err
    }
    throw new Error('預期reject但resolve')
}


describe('數字主鍵接w-orm-lowdb', function() {

    let so = null
    let proc = (mode, input) => so.procOrm('u1', 'tests', mode, input)
    let rows = async () => (await so.woItems.tests.select()).map((v) => [v.id, v.isActive])
    let quiet = async (fn) => {
        let logOrig = console.log
        console.log = () => {}
        try {
            return await fn()
        }
        finally {
            console.log = logOrig
        }
    }

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        so = WServOrm(ds, WOrm, `${fd}/db.json`, 'worm')
    })

    beforeEach(async function() {
        await so.woItems.tests.delAll()
    })

    after(async function() {
        await so.closeAll()
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('A08 數字主鍵存為其字串形式, 重送與修改命中同一筆, 以數字或字串皆可查可刪', async function() {
        //R-ID-02 規則2: 回報 = 實際; 重送不增筆(原每次另增genIDSeq之列); 寫入、查詢、刪除同一規則
        let r = await proc('insert', [{ id: 123, isActive: 'y' }])
        assert.deepStrictEqual(r, [{ id: '123' }])
        await proc('insert', [{ id: 123, isActive: 'y' }])
        await proc('save', [{ id: 123, isActive: 'n' }])
        await proc('mix', { diff: [{ id: 123, isActive: 'm' }] })
        assert.deepStrictEqual(await rows(), [['123', 'm']])
        assert.strictEqual((await proc('select', { id: 123 })).length, 1)
        assert.strictEqual((await proc('select', { id: '123' })).length, 1)
        let rd = await proc('del', [{ id: 123 }])
        assert.deepStrictEqual(rd, [{ n: 1, nDeleted: 1, ok: 1 }])
        assert.deepStrictEqual(await rows(), [])
    })

    it('A09 表內已有他方以字串寫入之同值主鍵: 以數字save覆寫該列, insert略過而回報字串主鍵', async function() {
        //R-ID-02 規則2: 123與'123'為同一筆(對外行為變更, 原另增genIDSeq之列)
        await so.woItems.tests.insert([{ id: '777', isActive: 'A' }])
        let rs = await proc('save', [{ id: 777, isActive: 'B' }])
        assert.deepStrictEqual(rs, [{ id: '777' }])
        let ri = await proc('insert', [{ id: 777, isActive: 'C' }])
        assert.deepStrictEqual(ri, [{ id: '777' }])
        assert.deepStrictEqual(await rows(), [['777', 'B']])
    })

    it('A10 以ltdtDiffByKey嚴格比對產生之add 888、del 888字串, 整批reject且表內不變', async function() {
        //R-MIX-01 規則1、2: 原為insert略過、del刪除而resolve遺失資料
        await so.woItems.tests.insert([{ id: '888', isActive: 'y' }])
        let old = await so.woItems.tests.select()
        let input = ltdtDiffByKey(old, [{ ...old[0], id: 888 }], 'id', { withInfor: false })
        assert.deepStrictEqual([input.add.length, input.del.length], [1, 1])
        let err = await quiet(() => getReject(proc('mix', input)))
        assert.strictEqual(err, 'invalid input of mix, same id in add and del: add[0], del[0]')
        assert.deepStrictEqual(await rows(), [['888', 'y']])
    })

    it('A11 同批之數字與其字串形式: 表內一筆(首筆內容), 回報兩筆同鍵', async function() {
        //R-ID-02 規則2; insert回傳之id含被略過者
        let r = await proc('insert', [{ id: 999, isActive: 'p' }, { id: '999', isActive: 'q' }])
        assert.deepStrictEqual(r, [{ id: '999' }, { id: '999' }])
        assert.deepStrictEqual(await rows(), [['999', 'p']])
    })

    it('A12 查詢與delAll之條件以數字給予: 等值、$in、$ne、$nin與$and、$or巢狀命中字串主鍵, 範圍依字典序', async function() {
        //R-ID-02 規則2(查詢條件)與已知限制(範圍依字典序: '40' < '5'); R-WL-01 規則3(只轉型白名單內之運算子)
        await proc('insert', [{ id: 5, isActive: 'y' }, { id: 40, isActive: 'y' }, { id: 'abc', isActive: 'y' }])
        let ids = async (find) => (await proc('select', find)).map((v) => v.id).sort()
        assert.deepStrictEqual(await ids({ id: 5 }), ['5'])
        assert.deepStrictEqual(await ids({ id: { $in: [5, 40] } }), ['40', '5'])
        assert.deepStrictEqual(await ids({ id: { $ne: 5 } }), ['40', 'abc'])
        assert.deepStrictEqual(await ids({ id: { $nin: [5] } }), ['40', 'abc'])
        assert.deepStrictEqual(await ids({ $or: [{ id: 5 }, { id: 40 }] }), ['40', '5'])
        assert.deepStrictEqual(await ids({ $and: [{ id: { $in: [5, 40] } }, { id: { $ne: 40 } }] }), ['5'])
        assert.deepStrictEqual(await ids({ id: { $lt: 5 } }), ['40'])
        let r1 = await proc('delAll', { id: { $in: [40] } })
        assert.deepStrictEqual(r1, { n: 1, nDeleted: 1, ok: 1 })
        let r2 = await proc('delAll', { id: 5 })
        assert.deepStrictEqual(r2, { n: 1, nDeleted: 1, ok: 1 })
        assert.deepStrictEqual(await rows(), [['abc', 'y']])
    })

    it('A19 白名單外之運算子: 後端reject, select以failed to select data、delAll以failed to delete data固定字串回傳, 表內容不變', async function() {
        //R-WL-01 規則3、4; R-ERR-01 規則1: 白名單由後端(w-orm-lowdb >= 1.0.32之cvOrmFind)把關, 本套件不轉型亦不放行, 後端原文只進log
        await proc('insert', [{ id: 5, isActive: 'y' }, { id: 40, isActive: 'y' }, { id: 'abc', isActive: 'y' }])
        let before = await rows()
        let finds = [
            { id: { $not: { $eq: 5 } } },
            { id: { $all: [5] } },
            { $nor: [{ id: 5 }] },
            { id: { $regex: '^a' } },
            { isActive: { $exists: true } },
            { $where: 'true' },
            { $expr: true },
        ]
        for (let find of finds) {
            let es = await quiet(() => getReject(proc('select', find)))
            assert.strictEqual(es, 'failed to select data', `select ${JSON.stringify(find)}`)
            let ed = await quiet(() => getReject(proc('delAll', find)))
            assert.strictEqual(ed, 'failed to delete data', `delAll ${JSON.stringify(find)}`)
        }
        assert.deepStrictEqual(await rows(), before, 'delAll被拒後表內容不變')
    })

})
