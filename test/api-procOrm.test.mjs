import fs from 'fs'
import assert from 'assert'
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs'
import ds from '../schema/index.mjs'
import WServOrm from '../src/WServOrm.mjs'


//以真ORM(w-orm-lowdb)經procOrm驗證逐筆失敗之回報; del帶無效主鍵為各w-orm後端共通之逐筆失敗(規格T6), 不須資料庫例外即可觸發
let fd = './test/_tmp/api-procOrm'

async function getReject(pm) {
    try {
        await pm
    }
    catch (err) {
        return err
    }
    throw new Error('預期reject但resolve')
}


describe('procOrm接w-orm-lowdb', function() {

    let so = null
    let proc = (mode, input) => so.procOrm('u1', 'tests', mode, input)

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        so = WServOrm(ds, WOrm, `${fd}/db.json`, 'worm')
    })

    after(async function() {
        await so.closeAll()
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('A01 save成功', async function() {
        //R04: 全部成功時回傳id, 數據已寫入
        let r = await proc('save', [{ id: 'a1', isActive: 'y' }])
        assert.strict.deepEqual(r, [{ id: 'a1' }])
        let rs = await proc('select', { id: 'a1' })
        assert.strict.equal(rs.length, 1)
    })

    it('A02 del含無效主鍵', async function() {
        //R02: 逐筆ok為0即reject並列出失敗筆(無有效主鍵者列位置); R10: 單筆失敗不中斷整批, 有效筆已刪除
        //無效主鍵取非字串非數字之值: 數字依R-ID-02轉為字串後為有效主鍵(未命中), 不再觸發逐筆失敗
        let err = await getReject(proc('del', [{ id: 'a1' }, { id: true }]))
        assert.strict.equal(err, 'failed to delete data: data[1]')
        let rs = await proc('select', { id: 'a1' })
        assert.strict.equal(rs.length, 0)
    })

    it('A03 mix之del含無效主鍵', async function() {
        //R03: del之逐筆失敗不中斷diff, diff已寫入, 最後reject列出del之失敗(未帶主鍵之列以位置列出)
        let err = await getReject(proc('mix', { del: [{ id: null }], diff: [{ id: 'a2', isActive: 'y' }] }))
        assert.strict.equal(err, 'failed to delete data: data[0]')
        let rs = await proc('select', { id: 'a2' })
        assert.strict.equal(rs.length, 1)
    })

    it('A04 del主鍵未命中', async function() {
        //R04: 主鍵未命中屬正常結果, 回傳ORM原始逐筆陣列
        let r = await proc('del', [{ id: 'a-none' }])
        assert.strict.deepEqual(r, [{ n: 0, nDeleted: 0, ok: 1 }])
    })

    it('A05 save未帶主鍵時回傳之id可於資料庫查得', async function() {
        //D1: 本套件補值並回傳, 與實際寫入之主鍵一致
        let r = await proc('save', [{ isActive: 'y' }])
        assert.ok(typeof r[0].id === 'string' && r[0].id.length > 0)
        let rs = await proc('select', { id: r[0].id })
        assert.strict.equal(rs.length, 1)
    })

    it('A06 主鍵為數學式者可依原主鍵查詢與刪除', async function() {
        //wsemi 1.9.13起數學式不被clearXSS改寫, 寫入之主鍵即呼叫端所持者(1.9.12時會存成a &lt; b而查不到、刪不掉)
        let r = await proc('save', [{ id: 'a < b', isActive: 'y' }])
        assert.strict.deepEqual(r, [{ id: 'a < b' }])
        let rs = await proc('select', { id: 'a < b' })
        assert.strict.equal(rs.length, 1)
        let rd = await proc('del', [{ id: 'a < b' }])
        assert.strict.deepEqual(rd, [{ n: 1, nDeleted: 1, ok: 1 }])
    })

    it('A07 主鍵會被改寫者整批拒絕且未寫入任何一筆', async function() {
        let err = await getReject(proc('save', [{ id: 'ok-2', isActive: 'y' }, { id: 'a<b', isActive: 'y' }]))
        assert.strict.equal(err, 'failed to save data, id contains HTML markup: data[1]')
        let rs = await proc('select', {})
        assert.ok(!rs.some((v) => ['ok-2', 'a<b', 'a&lt;b'].includes(v.id)), JSON.stringify(rs))
    })

})


//R-PERITEM-01 規則4(orm-run03、run04): 包一層真ORM(w-orm-lowdb), 令insert於injectInsert為true時第0筆不寫入、其餘筆照常寫入, 並回傳聚合物件而ok為0; 為'array'時回傳逐筆陣列而第0筆ok為0(模擬違約之ORM, w-orm-lowdb實際不會如此); 其餘操作原樣
let fdIns = './test/_tmp/api-procOrm-insertfail'
let injectInsert = false
//R-ORM-RESULT-01(orm-run05): injectOther為'save'、'del'或'delAll'時, 該操作照常執行後回傳聚合物件而ok為0(非契約形狀, 模擬違約之ORM)
let injectOther = null
function WOrmInsertFail(...args) {
    let wo = WOrm(...args)
    for (let m of ['save', 'del', 'delAll']) {
        let orig = wo[m]
        wo[m] = async (...a) => {
            let r = await orig(...a)
            return injectOther === m ? { n: 1, ok: 0, err: 'E-agg' } : r
        }
    }
    let insertOrig = wo.insert
    wo.insert = async (data) => {
        if (!injectInsert) {
            return insertOrig(data)
        }
        let rows = Array.isArray(data) ? data : [data]
        let rest = rows.slice(1)
        if (rest.length > 0) {
            await insertOrig(rest)
        }
        if (injectInsert === 'array') {
            return rows.map((v, k) => (k === 0 ? { n: 1, nInserted: 0, ok: 0, err: 'E-ins' } : { n: 1, nInserted: 1, ok: 1 }))
        }
        return { n: rows.length, nInserted: rest.length, ok: 0, err: 'E-ins' }
    }
    return wo
}


describe('procOrm接insert回報ok為0之w-orm-lowdb', function() {

    let so = null
    let proc = (mode, input) => so.procOrm('u1', 'tests', mode, input)
    let getIds = async () => (await so.woItems.tests.select({})).map((v) => v.id).sort()

    before(function() {
        fs.rmSync(fdIns, { recursive: true, force: true })
        fs.mkdirSync(fdIns, { recursive: true })
        so = WServOrm(ds, WOrmInsertFail, `${fdIns}/db.json`, 'worm')
    })

    beforeEach(async function() {
        injectInsert = false
        injectOther = null
        await so.woItems.tests.delAll({})
        await so.woItems.tests.insert([{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }])
    })

    after(async function() {
        injectInsert = false
        injectOther = null
        await so.closeAll()
        fs.rmSync(fdIns, { recursive: true, force: true })
    })

    it('F01 insert之ORM回報ok為0時reject而不回成功', async function() {
        //規則4: 聚合結果ok為0視為失敗; 已寫入之筆無從回復(ORM違約, 第1筆已寫入、第0筆未寫入), 但呼叫端得知失敗
        injectInsert = true
        let err = await getReject(proc('insert', [{ id: 'n1' }, { id: 'n2' }]))
        assert.strict.equal(err, 'failed to insert data')
        assert.strict.deepEqual(await getIds(), ['n2', 'x1', 'x2', 'x3'])
    })

    it('F02 mix之add之ORM回報ok為0時reject且後續del不執行', async function() {
        //規則4: add為首步, 聚合結果ok為0即立即reject, del步驟不執行(x3仍在庫內)
        injectInsert = true
        let err = await getReject(proc('mix', { add: [{ id: 'n1' }, { id: 'n2' }], del: [{ id: 'x3' }] }))
        assert.strict.equal(err, 'failed to insert data')
        assert.strict.deepEqual(await getIds(), ['n2', 'x1', 'x2', 'x3'])
    })

    it('F04 insert之ORM回報陣列形逐筆ok為0時reject而不回成功', async function() {
        //規則4(orm-run04): 陣列形任一筆ok為0同聚合形處置; 其餘筆已寫入(n2)無從回復
        injectInsert = 'array'
        let err = await getReject(proc('insert', [{ id: 'n1' }, { id: 'n2' }]))
        assert.strict.equal(err, 'failed to insert data')
        assert.strict.deepEqual(await getIds(), ['n2', 'x1', 'x2', 'x3'])
    })

    it('F05 mix之add之ORM回報陣列形逐筆ok為0時reject且後續del不執行', async function() {
        //規則4(orm-run04): add為首步, 立即reject, del步驟不執行(x3仍在庫內)
        injectInsert = 'array'
        let err = await getReject(proc('mix', { add: [{ id: 'n1' }, { id: 'n2' }], del: [{ id: 'x3' }] }))
        assert.strict.equal(err, 'failed to insert data')
        assert.strict.deepEqual(await getIds(), ['n2', 'x1', 'x2', 'x3'])
    })

    it('F06 delAll之ORM回報聚合物件ok為0時reject而不回成功', async function() {
        //R-ORM-RESULT-01(orm-run05): ORM已執行刪除而回報ok為0(違約), 呼叫端得知失敗
        injectOther = 'delAll'
        let err = await getReject(proc('delAll', { id: 'x1' }))
        assert.strict.equal(err, 'failed to delete data')
        injectOther = null
        assert.strict.deepEqual(await getIds(), ['x2', 'x3'])
    })

    it('F07 save與del之ORM回報聚合物件ok為0時reject而不回成功', async function() {
        //R-ORM-RESULT-01(orm-run05): 契約為逐筆陣列, 聚合形(非契約形狀)無從逐筆列出, 固定字串reject
        injectOther = 'save'
        let err = await getReject(proc('save', [{ id: 'x1', isActive: 'n' }]))
        assert.strict.equal(err, 'failed to save data')
        injectOther = 'del'
        err = await getReject(proc('del', [{ id: 'x2' }]))
        assert.strict.equal(err, 'failed to delete data')
    })

    it('F08 mix之del回報聚合物件ok為0時立即reject且diff不執行', async function() {
        //R-ORM-RESULT-01(orm-run05): del為第2步, 聚合形失敗即整批性, diff步驟不執行(x1之isActive仍為預設而未被改為n)
        injectOther = 'del'
        let err = await getReject(proc('mix', { del: [{ id: 'x3' }], diff: [{ id: 'x1', isActive: 'n' }] }))
        assert.strict.equal(err, 'failed to delete data')
        injectOther = null
        let rs = await so.woItems.tests.select({ id: 'x1' })
        assert.ok(rs.length === 1 && rs[0].isActive !== 'n', JSON.stringify(rs))
    })

    it('F09 契約內之ORM(delAll恆ok為1)行為不變', async function() {
        //R-ORM-RESULT-01: 未違約時delAll、save、del照常resolve
        let r = await proc('delAll', { id: 'x1' })
        assert.strict.deepEqual(r, { n: 1, nDeleted: 1, ok: 1 })
        let r2 = await proc('save', [{ id: 'x2', isActive: 'n' }])
        assert.strict.deepEqual(r2, [{ id: 'x2' }])
        let r3 = await proc('del', [{ id: 'x3' }])
        assert.strict.deepEqual(r3, [{ n: 1, nDeleted: 1, ok: 1 }])
    })

    it('F03 契約內之ORM(insert恆ok為1)行為不變', async function() {
        //規則4: 未違約時insert與mix照常resolve並寫入; 略過既有主鍵(n為0)亦照常
        let r = await proc('insert', [{ id: 'n1' }, { id: 'x1' }])
        assert.strict.deepEqual(r, [{ id: 'n1' }, { id: 'x1' }])
        let r2 = await proc('mix', { add: [{ id: 'n2' }], del: [{ id: 'x3' }] })
        assert.strict.deepEqual(r2, [{ id: 'n2' }, { id: 'x3' }])
        assert.strict.deepEqual(await getIds(), ['n1', 'n2', 'x1', 'x2'])
    })

})
