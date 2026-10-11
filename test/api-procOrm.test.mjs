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
        assert.strict.equal(err, '刪除資料失敗: id[123]')
        let rs = await proc('select', { id: 'a1' })
        assert.strict.equal(rs.length, 0)
    })

    it('A03 mix之del含無效主鍵', async function() {
        //R03: del之逐筆失敗不中斷diff, diff已寫入, 最後reject列出del之失敗
        let err = await getReject(proc('mix', { del: [{ id: 456 }], diff: [{ id: 'a2', isActive: 'y' }] }))
        assert.strict.equal(err, '刪除資料失敗: id[456]')
        let rs = await proc('select', { id: 'a2' })
        assert.strict.equal(rs.length, 1)
    })

    it('A04 del主鍵未命中', async function() {
        //R04: 主鍵未命中屬正常結果, 回傳ORM原始逐筆陣列
        let r = await proc('del', [{ id: 'a-none' }])
        assert.strict.deepEqual(r, [{ n: 0, nDeleted: 0, ok: 1 }])
    })

})
