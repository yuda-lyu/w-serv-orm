import fs from 'fs'
import assert from 'assert'
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs'
import build from 'w-data-collector/src/build.mjs'
import WServOrm from '../src/WServOrm.mjs'
import { getReject, quiet } from './tools/ormStub.mjs'


//規格: w-web-sso 需求 T2①(任務 orm-run02): tokens.userId是權杖擁有者, procOrm insert以opt.keepUserId保留擁有者並將userIdUpdate記為操作者; 規則帳本 R-KEEPUSER-01
//以真ORM(w-orm-lowdb)經procOrm與guardWrite驗證; 替身ORM版(含各mode、擴充函數、直接getMapOrm)見 unit-keepuser.test.mjs
//
//規格句對照(spec = 派工提示詞「本輪範圍」與〈完成條件〉1):
//  A01-A02 「keepUserId:true 時保留擁有者、userIdUpdate 為操作者」(sso依擁有者分組之寫入)  A03 「列無userId時以操作者補」
//  A04 「未給或false時行為與現行完全相同」  A05 「無效opt於寫入前拒收」  A06 「save現行不覆寫userId」之評估  A07 於表鎖與guardWrite內之實際用法
let fd = './test/_tmp/api-keepuser'

function mkTab(keyTable) {
    return build({
        keyTable,
        settings: {
            id: { pk: true, name: '主鍵', type: 'STRING' },
            name: { name: '名稱', type: 'STRING' },
            userId: { name: '擁有者', type: 'STRING' },
            userIdUpdate: { name: '更新者', type: 'STRING' },
            timeCreate: { name: '創建時間', type: 'STRING' },
            timeUpdate: { name: '更新時間', type: 'STRING' },
        },
    }, { useCreateStorage: false })
}


describe('procOrm opt.keepUserId接w-orm-lowdb(T2①)', function() {

    let so = null
    let proc = (user, mode, input, opt) => so.procOrm(user, 'tokens', mode, input, opt)
    let sel = () => so.woItems.tokens.select({})
    let byId = async (id) => (await so.woItems.tokens.select({ id: { $in: [id] } }))[0]

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        so = WServOrm({ tokens: mkTab('tokens') }, WOrm, `${fd}/db.json`, 'worm')
    })

    beforeEach(async function() {
        await so.woItems.tokens.delAll({})
    })

    after(async function() {
        await so.closeAll()
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('A01 sso情境: 操作者admin-1代擁有者owner-1建立權杖, 庫內userId為擁有者、userIdUpdate為操作者, 時間欄補值', async function() {
        let r = await proc('admin-1', 'insert', [{ id: 't1', name: 'tk', userId: 'owner-1' }], { keepUserId: true })
        assert.deepStrictEqual(r, [{ id: 't1' }])
        let row = await byId('t1')
        assert.strict.equal(row.userId, 'owner-1')
        assert.strict.equal(row.userIdUpdate, 'admin-1')
        assert.strict.equal(row.name, 'tk')
        assert.ok(/^\d{4}-\d{2}-\d{2}/.test(row.timeCreate), row.timeCreate)
        assert.strict.equal(row.timeUpdate, row.timeCreate)
    })

    it('A02 同一批多位擁有者: 各列各自保留其擁有者, userIdUpdate皆為操作者', async function() {
        await proc('admin-1', 'insert', [{ id: 't1', userId: 'owner-1' }, { id: 't2', userId: 'owner-2' }, { id: 't3', userId: 'owner-1' }], { keepUserId: true })
        let rows = (await sel()).sort((a, b) => a.id.localeCompare(b.id))
        assert.deepStrictEqual(rows.map((v) => [v.id, v.userId, v.userIdUpdate]), [['t1', 'owner-1', 'admin-1'], ['t2', 'owner-2', 'admin-1'], ['t3', 'owner-1', 'admin-1']])
    })

    it('A03 列無userId(缺欄、空字串、null、數字): 以操作者補', async function() {
        await proc('admin-1', 'insert', [{ id: 't1' }, { id: 't2', userId: '' }, { id: 't3', userId: null }, { id: 't4', userId: 7 }, { id: 't5', userId: 'owner-5' }], { keepUserId: true })
        let got = Object.fromEntries((await sel()).map((v) => [v.id, v.userId]))
        assert.deepStrictEqual(got, { t1: 'admin-1', t2: 'admin-1', t3: 'admin-1', t4: 'admin-1', t5: 'owner-5' })
    })

    it('A04 未給opt或{keepUserId:false}: 與現行相同(列上userId被操作者覆寫)', async function() {
        await proc('admin-1', 'insert', [{ id: 't1', userId: 'owner-1' }])
        await proc('admin-2', 'insert', [{ id: 't2', userId: 'owner-2' }], { keepUserId: false })
        await proc('admin-3', 'insert', [{ id: 't3', userId: 'owner-3' }], {})
        let got = Object.fromEntries((await sel()).map((v) => [v.id, [v.userId, v.userIdUpdate]]))
        assert.deepStrictEqual(got, { t1: ['admin-1', 'admin-1'], t2: ['admin-2', 'admin-2'], t3: ['admin-3', 'admin-3'] })
    })

    it('A05 無效opt於寫入前拒收且零寫入: keepUserId非布林、未知鍵、用於save/del/select/delAll/mix; 既有列不變', async function() {
        await proc('admin-1', 'insert', [{ id: 'r1', name: 'A', userId: 'owner-1' }], { keepUserId: true })
        let before = JSON.stringify(await sel())
        let cases = [
            ['insert', [{ id: 'n1', userId: 'o' }], { keepUserId: 'true' }, 'invalid opt of procOrm, keepUserId needs a boolean'],
            ['insert', [{ id: 'n1', userId: 'o' }], { keepuserid: true }, 'invalid opt of procOrm, unsupported key'],
            ['save', [{ id: 'r1', name: 'B', userId: 'owner-1' }], { keepUserId: true }, 'invalid opt of procOrm, keepUserId supports only insert'],
            ['del', [{ id: 'r1' }], { keepUserId: true }, 'invalid opt of procOrm, keepUserId supports only insert'],
            ['delAll', {}, { keepUserId: true }, 'invalid opt of procOrm, keepUserId supports only insert'],
            ['select', {}, { keepUserId: true }, 'invalid opt of procOrm, keepUserId supports only insert'],
            ['mix', { add: [{ id: 'n2', userId: 'o' }] }, { keepUserId: true }, 'invalid opt of procOrm, keepUserId supports only insert'],
        ]
        for (let [mode, input, opt, msg] of cases) {
            let err = await quiet(() => getReject(proc('admin-2', mode, input, opt)))
            assert.strict.equal(err, msg, `${mode} ${JSON.stringify(opt)}`)
        }
        assert.strict.equal(JSON.stringify(await sel()), before)
    })

    it('A06 save現行不覆寫userId: 保留擁有者之列經save修改, userId維持(列上帶原值)、userIdUpdate為修改者; keepUserId不適用save', async function() {
        await proc('admin-1', 'insert', [{ id: 't1', name: 'A', userId: 'owner-1' }], { keepUserId: true })
        let row = await byId('t1')
        await proc('admin-2', 'save', [{ ...row, name: 'B' }])
        let row2 = await byId('t1')
        assert.strict.equal(row2.userId, 'owner-1')
        assert.strict.equal(row2.userIdUpdate, 'admin-2')
        assert.strict.equal(row2.name, 'B')
        assert.strict.equal(row2.timeCreate, row.timeCreate)
        let err = await quiet(() => getReject(proc('admin-2', 'save', [{ ...row, name: 'C' }], { keepUserId: true })))
        assert.strict.equal(err, 'invalid opt of procOrm, keepUserId supports only insert')
        assert.strict.equal((await byId('t1')).name, 'B')
    })

    it('A07 於withTabLocks與guardWrite之write內使用: 與mustExist(另一次save)並用, 鎖內寫入成功', async function() {
        await so.guardWrite({
            tables: ['tokens'],
            read: () => so.woItems.tokens.select({}),
            write: () => proc('admin-1', 'insert', [{ id: 't1', name: 'A', userId: 'owner-1' }], { keepUserId: true }),
        })
        await so.withTabLocks(['tokens'], async () => {
            await proc('admin-2', 'save', [{ id: 't1', name: 'B', userId: 'owner-1' }], { mustExist: true })
        })
        let row = await byId('t1')
        assert.deepStrictEqual([row.userId, row.userIdUpdate, row.name], ['owner-1', 'admin-2', 'B'])
    })

})
