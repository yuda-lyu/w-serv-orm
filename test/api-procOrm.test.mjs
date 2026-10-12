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
        so = WServOrm(ds, WOrm, `${fd}/db.json`, 'worm', { useCheckUser: false, useExcludeWhenNotAdmin: false })
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
        //R02: 逐筆ok為0即reject並列出失敗主鍵; R10: 單筆失敗不中斷整批, 有效筆已刪除
        let err = await getReject(proc('del', [{ id: 'a1' }, { id: 123 }]))
        assert.strict.equal(err, 'failed to delete data: id[123]')
        let rs = await proc('select', { id: 'a1' })
        assert.strict.equal(rs.length, 0)
    })

    it('A03 mix之del含無效主鍵', async function() {
        //R03: del之逐筆失敗不中斷diff, diff已寫入, 最後reject列出del之失敗
        let err = await getReject(proc('mix', { del: [{ id: 456 }], diff: [{ id: 'a2', isActive: 'y' }] }))
        assert.strict.equal(err, 'failed to delete data: id[456]')
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
