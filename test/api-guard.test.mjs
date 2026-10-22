import fs from 'fs'
import assert from 'assert'
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs'
import build from 'w-data-collector/src/build.mjs'
import WServOrm from '../src/WServOrm.mjs'
import { buildBaseline, compareBaseline, pickWriteRow, getRejectKey } from '../src/baseline.mjs'
import { getReject, quiet } from './tools/ormStub.mjs'


//規格: 多人同時編輯之寫入契約 V2、V4、V5、V6、V7、V9、V10、V14; 規則帳本 R-GUARD-01、R-ONLYMOD-01
//以真ORM(w-orm-lowdb)經procOrm、withTabLocks、guardWrite驗證只改不增、刪除未命中、鎖內原子與基準之傳輸等價; 替身ORM版(含逐筆事後偵測、opt驗證)見 unit-guard.test.mjs
//
//規格句對照(spec = C:\opensrcOper\dspec\多人同時編輯之寫入契約.md §13 驗收):
//  R01-R04、R06 V6「修改時該列已被刪 → rowNotFound, 列不復活」  R05、R08 V7「刪除已不存在之列(帶或不帶基準) → rowNotFound」  R07 §5「逐列存檔之基準」、V6
//  R09 V10「前端算之基準(經實際傳輸路徑)＝伺服端新鮮讀取所算」、V5「系統寫伺服器專有欄位後, 後台存檔可存, 且該欄維持系統所寫之值」
//  R10 V2/V3/V4「外部同步相同內容基準不變 / 改變內容被拒 / 系統直寫雙方欄位後舊基準被拒」  R11 V9「他人重排被拒 / 系統重編號可存」
//  R12 V14「並行: 比對與寫入間插入他人寫入 → 不可能發生」  R13 §7「多表依表名碼元排序取鎖」  R14 實作者補強(逾 $in 上限之大批), 見規則帳本 R-ONLYMOD-01 規則 11
let fd = './test/_tmp/api-guard'

let wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function mkTab(keyTable) {
    return build({
        keyTable,
        settings: {
            id: { pk: true, name: '主鍵', type: 'STRING' },
            name: { name: '名稱', type: 'STRING' },
            blocked: { name: '封鎖', type: 'STRING' },
            pw: { name: '密碼', type: 'STRING' },
            tags: { name: '標籤', type: 'STRING' },
            order: { name: '排序', type: 'INTEGER' },
            userIdUpdate: { name: '更新者', type: 'STRING' },
            timeCreate: { name: '創建時間', type: 'STRING' },
            timeUpdate: { name: '更新時間', type: 'STRING' },
        },
    }, { useCreateStorage: false })
}

//契約: blocked為雙方欄位(後台可改、系統亦寫), pw為伺服器專有, order為重編型之名次
let CT = { table: 'items', pk: 'id', fields: ['name', 'blocked', 'tags'], serverOnly: ['pw'], orderKey: 'order' }


describe('procOrm opt與guardWrite接w-orm-lowdb', function() {

    let so = null
    let proc = (mode, input, opt, tab = 'items') => so.procOrm('u1', tab, mode, input, opt)
    let sel = (tab = 'items') => so.woItems[tab].select({})
    let byId = async (id, tab = 'items') => (await so.woItems[tab].select({ id: { $in: [id] } }))[0]

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        so = WServOrm({ items: mkTab('items'), items2: mkTab('items2') }, WOrm, `${fd}/db.json`, 'worm')
    })

    beforeEach(async function() {
        await so.woItems.items.delAll({})
        await so.woItems.items2.delAll({})
    })

    after(async function() {
        await so.closeAll()
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('R01 修改不存在之列: rowNotFound, 列未被建立(V6); 未帶opt之既有行為仍為新增', async function() {
        let err = await quiet(() => getReject(proc('save', [{ id: 'ghost', name: 'x' }], { mustExist: true })))
        assert.strict.equal(err, 'rowNotFound')
        assert.strict.equal((await sel()).length, 0)

        //既有行為(不變): save對不存在之列自動新增
        let r = await proc('save', [{ id: 'ghost', name: 'x' }])
        assert.deepStrictEqual(r, [{ id: 'ghost' }])
        assert.strict.equal((await sel()).length, 1)
    })

    it('R02 修改已被他人刪除之列: rowNotFound且列不復活(V6)', async function() {
        await proc('save', [{ id: 'r1', name: 'A' }])
        await proc('del', [{ id: 'r1' }]) //他人先刪
        let err = await quiet(() => getReject(proc('save', [{ id: 'r1', name: 'A2' }], { mustExist: true })))
        assert.strict.equal(err, 'rowNotFound')
        assert.strict.equal(await byId('r1'), undefined)
    })

    it('R03 多列中一列不存在: 零寫入, 存在之列之值與更新時間皆不變', async function() {
        await proc('save', [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }])
        let before = JSON.stringify(await sel())
        await wait(5)
        let err = await quiet(() => getReject(proc('save', [{ id: 'r1', name: 'A2' }, { id: 'ghost', name: 'x' }, { id: 'r2', name: 'B2' }], { mustExist: true })))
        assert.strict.equal(err, 'rowNotFound')
        assert.strict.equal(JSON.stringify(await sel()), before)
    })

    it('R04 全部存在: 修改成功, 未給之欄位保留, 系統欄位依既有規則補值(userIdUpdate、timeUpdate), timeCreate不變', async function() {
        await proc('save', [{ id: 'r1', name: 'A', pw: 'secret' }])
        let v0 = await byId('r1')
        await wait(5)
        let r = await so.procOrm('u9', 'items', 'save', [{ id: 'r1', name: 'A2' }], { mustExist: true })
        assert.deepStrictEqual(r, [{ id: 'r1' }])
        let v1 = await byId('r1')
        assert.strict.equal(v1.name, 'A2')
        assert.strict.equal(v1.pw, 'secret')
        assert.strict.equal(v1.userIdUpdate, 'u9')
        assert.notStrictEqual(v1.timeUpdate, v0.timeUpdate)
        assert.strict.equal(v1.timeCreate, v0.timeCreate)
    })

    it('R05 刪除不存在之列: rowNotFound(V7), 多列中一列不存在則零刪除; 全部存在則刪除; 未帶opt時仍回逐筆{n:0,nDeleted:0,ok:1}', async function() {
        await proc('save', [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }])
        let e1 = await quiet(() => getReject(proc('del', [{ id: 'ghost' }], { mustExist: true })))
        assert.strict.equal(e1, 'rowNotFound')
        let e2 = await quiet(() => getReject(proc('del', [{ id: 'r1' }, { id: 'ghost' }], { mustExist: true })))
        assert.strict.equal(e2, 'rowNotFound')
        assert.strict.equal((await sel()).length, 2, '零刪除')
        let r = await proc('del', [{ id: 'r1' }, { id: 'r2' }], { mustExist: true })
        assert.deepStrictEqual(r.map((v) => v.nDeleted), [1, 1])
        assert.strict.equal((await sel()).length, 0)
        let r0 = await proc('del', [{ id: 'r1' }])
        assert.deepStrictEqual(r0, [{ n: 0, nDeleted: 0, ok: 1 }])
    })

    it('R06 修改時未帶主鍵之列不補號新增: rowNotFound(表列數不變)', async function() {
        await proc('save', [{ id: 'r1', name: 'A' }])
        let err = await quiet(() => getReject(proc('save', [{ name: 'no-id' }], { mustExist: true })))
        assert.strict.equal(err, 'rowNotFound')
        assert.strict.equal((await sel()).length, 1)
    })

    it('R07 guardWrite逐列存檔(帶基準): 該列已被刪 → rowNotFound且零寫入(V6); 該列被改 → baselineMismatch; 未改 → 寫入成功', async function() {
        await proc('save', [{ id: 'r1', name: 'A', order: 1 }, { id: 'r2', name: 'B', order: 2 }])
        let rowsLoaded = await sel()
        let blOne = buildBaseline(rowsLoaded.filter((v) => v.id === 'r1'), CT)
        let readOne = () => so.woItems.items.select({ id: { $in: ['r1'] } })
        let save = (name, baseline) => so.guardWrite({
            tables: ['items'],
            read: readOne,
            baseline,
            contract: CT,
            write: () => proc('save', [{ id: 'r1', name }], { mustExist: true }),
        })

        assert.deepStrictEqual(await save('A2', blOne), [{ id: 'r1' }])
        assert.strict.equal((await byId('r1')).name, 'A2')
        let e1 = await quiet(() => getReject(save('A3', blOne)))
        assert.strict.equal(e1.key, 'baselineMismatch', '前一次已改, 舊基準被拒')
        await proc('del', [{ id: 'r1' }])
        let e2 = await quiet(() => getReject(save('A4', blOne)))
        assert.strict.equal(e2.key, 'rowNotFound')
        assert.strict.equal(await byId('r1'), undefined, '已刪之列不復活')
        //不帶基準之寫入(外部應用型): 取鎖、只改不增, 該列已不存在 → rowNotFound
        let e3 = await quiet(() => getReject(save('A5', undefined)))
        assert.strict.equal(e3, 'rowNotFound')
        assert.strict.equal(await byId('r1'), undefined)
    })

    it('R08 刪除(帶或不帶基準)已不存在之列皆rowNotFound(V7)', async function() {
        await proc('save', [{ id: 'r1', name: 'A', order: 1 }])
        let bl = buildBaseline(await sel(), CT)
        let del = (baseline) => so.guardWrite({
            tables: ['items'],
            read: () => so.woItems.items.select({ id: { $in: ['r1'] } }),
            baseline,
            contract: CT,
            write: () => proc('del', [{ id: 'r1' }], { mustExist: true }),
        })
        let r = await del(bl)
        assert.strict.equal(r[0].nDeleted, 1)
        let e1 = await quiet(() => getReject(del(bl)))
        assert.strict.equal(e1.key, 'rowNotFound', '帶基準: 該列已不在')
        let e2 = await quiet(() => getReject(del(undefined)))
        assert.strict.equal(e2, 'rowNotFound', '不帶基準: 以存在檢查回報')
    })

    it('R09 傳輸等價(V10): 後端讀回之列算出之基準, 與經JSON傳輸之列算出者相同; 系統欄位(userIdUpdate、timeUpdate)與serverOnly變動不影響(V5)', async function() {
        await proc('save', [{ id: 'r2', name: 'B', order: 2, tags: '[x]', blocked: 'n' }, { id: 'r1', name: 'A', order: 1, pw: 'p1' }])
        let server = await sel()
        let wire = JSON.parse(JSON.stringify(server))
        let bl = buildBaseline(server, CT)
        assert.deepStrictEqual(buildBaseline(wire, CT), bl)
        assert.deepStrictEqual(bl.map((v) => v[0]), ['r1', 'r2'])
        //系統寫入伺服器專有欄位(例如密碼)與系統欄位: 基準不變, 後台以舊基準仍可存
        await wait(5)
        await so.procOrm('system', 'items', 'save', [{ id: 'r1', pw: 'changed-by-system' }])
        assert.deepStrictEqual(compareBaseline(await sel(), bl, CT), { ok: true })
        let r = await so.guardWrite({
            tables: ['items'],
            read: () => sel(),
            baseline: bl,
            contract: CT,
            write: () => proc('save', [{ id: 'r1', name: 'A-admin' }], { mustExist: true }),
        })
        assert.deepStrictEqual(r, [{ id: 'r1' }])
        let v = await byId('r1')
        assert.strict.equal(v.pw, 'changed-by-system', '後台存檔未採用伺服器專有欄位, 維持系統所寫之值')
    })

    it('R09b V5(外審sol#4): 客戶端持舊列(含舊之伺服器專有欄位pw)整列送出時, 寫入前經pickWriteRow白名單則pw維持系統所寫之值; 不經白名單直接寫入則被回寫成舊值(說明白名單之必要)', async function() {
        await proc('save', [{ id: 'r1', name: 'A', pw: 'old', order: 1, blocked: 'n' }])
        let loaded = (await sel())[0] //客戶端載入之整列, 含舊pw
        let bl = buildBaseline([loaded], CT)
        await so.procOrm('system', 'items', 'save', [{ id: 'r1', pw: 'new-by-system' }], { mustExist: true })
        let draft = { ...loaded, name: 'A-edited' } //客戶端整列送出(含舊pw)

        let guardSave = (row) => so.guardWrite({
            tables: ['items'],
            read: () => sel(),
            baseline: bl,
            contract: CT,
            write: () => proc('save', [row], { mustExist: true }),
        })
        //經白名單: 基準比對通過(pw不入基準), pw維持系統值
        await guardSave(pickWriteRow(draft, CT))
        let v = await byId('r1')
        assert.strict.equal(v.name, 'A-edited')
        assert.strict.equal(v.pw, 'new-by-system')
        //不經白名單(對照): 同一基準仍可存, 但pw被回寫成舊值
        await so.procOrm('system', 'items', 'save', [{ id: 'r1', pw: 'new2-by-system' }], { mustExist: true })
        let bl2 = buildBaseline(await sel(), CT)
        await so.guardWrite({ tables: ['items'], read: () => sel(), baseline: bl2, contract: CT, write: () => proc('save', [{ ...draft, name: 'A-naive' }], { mustExist: true }) })
        assert.strict.equal((await byId('r1')).pw, 'old', '不經白名單則舊值被回寫(此即pickWriteRow存在之理由)')
    })

    it('R10 雙方欄位被系統改動後, 持舊基準之後台存檔被拒(V4); 外部同步以相同內容整批重寫(delAll加insert)則基準不變(V2); 外部同步改內容則被拒(V3)', async function() {
        await proc('save', [{ id: 'r1', name: 'A', blocked: 'n', order: 1 }, { id: 'r2', name: 'B', blocked: 'n', order: 2 }])
        let bl = buildBaseline(await sel(), CT)
        let tryAdmin = () => so.guardWrite({ tables: ['items'], read: () => sel(), baseline: bl, contract: CT, write: async () => 'saved' })

        //外部同步: 內容相同(系統欄位之時間必不同)
        let rowsSame = [{ id: 'r1', name: 'A', blocked: 'n', order: 1 }, { id: 'r2', name: 'B', blocked: 'n', order: 2 }]
        await wait(5)
        await so.withTabLocks(['items'], async () => {
            await so.procOrm('sync', 'items', 'delAll', {})
            await so.procOrm('sync', 'items', 'insert', rowsSame)
        })
        assert.strict.equal(await tryAdmin(), 'saved', '內容不變, 後台以同步前之基準可存(V2)')

        //外部同步: 內容改變
        await so.withTabLocks(['items'], async () => {
            await so.procOrm('sync', 'items', 'delAll', {})
            await so.procOrm('sync', 'items', 'insert', [{ id: 'r1', name: 'A-ext', blocked: 'n', order: 1 }, rowsSame[1]])
        })
        let e1 = await quiet(() => getReject(tryAdmin()))
        assert.strict.equal(e1.key, 'baselineMismatch')
        assert.deepStrictEqual(e1.changed, ['r1'])

        //系統直寫雙方欄位(封鎖)
        let bl2 = buildBaseline(await sel(), CT)
        await so.withTabLocks(['items'], () => so.procOrm('system', 'items', 'save', [{ id: 'r2', blocked: 'y' }], { mustExist: true }))
        let e2 = await quiet(() => getReject(so.guardWrite({ tables: ['items'], read: () => sel(), baseline: bl2, contract: CT, write: async () => 'saved' })))
        assert.strict.equal(e2.key, 'baselineMismatch')
        assert.deepStrictEqual(e2.changed, ['r2'])
    })

    it('R11 他人重排被偵測、系統重編號不被偵測(V9)', async function() {
        await proc('save', [{ id: 'r1', name: 'A', order: 1 }, { id: 'r2', name: 'B', order: 2 }, { id: 'r3', name: 'C', order: 3 }])
        let bl = buildBaseline(await sel(), CT)
        let g = () => so.guardWrite({ tables: ['items'], read: () => sel(), baseline: bl, contract: CT, write: async () => 'saved' })

        await proc('save', [{ id: 'r1', order: 10 }, { id: 'r2', order: 20 }, { id: 'r3', order: 30 }])
        assert.strict.equal(await g(), 'saved', '重編號(名次不變)可存')

        await proc('save', [{ id: 'r1', order: 20 }, { id: 'r2', order: 10 }])
        let e = await quiet(() => getReject(g()))
        assert.strict.equal(e.key, 'baselineMismatch')
        assert.strict.equal(e.reordered, true)
        assert.deepStrictEqual(e.changed, [])
    })

    it('R12 原子(V14, 真ORM): 比對與寫入之間插不進他人之寫入(withTabLocks與另一guardWrite), 他人於其後才執行; 最終值為最後取得鎖者之值', async function() {
        await proc('save', [{ id: 'r1', name: 'orig', order: 1 }])
        let bl = buildBaseline(await sel(), CT)
        let log = []
        let g = so.guardWrite({
            tables: ['items'],
            read: async () => {
                log.push('g:read-start')
                await wait(60)
                log.push('g:read-end')
                return sel()
            },
            baseline: bl,
            contract: CT,
            write: async () => {
                log.push('g:write-start')
                await wait(60)
                await proc('save', [{ id: 'r1', name: 'from-g' }], { mustExist: true })
                log.push('g:write-end')
            },
        })
        await wait(15)
        let x = so.withTabLocks(['items'], async () => {
            log.push('x:in')
            await proc('save', [{ id: 'r1', name: 'from-x' }])
            log.push('x:out')
        })
        let y = so.guardWrite({
            tables: ['items'],
            read: () => sel(),
            baseline: bl,
            contract: CT,
            write: async () => {
                log.push('y:write')
            },
        }).catch((e) => log.push(`y:${e.key}`))
        await Promise.all([g, x, y])
        assert.deepStrictEqual(log, ['g:read-start', 'g:read-end', 'g:write-start', 'g:write-end', 'x:in', 'x:out', 'y:baselineMismatch'])
        assert.strict.equal((await byId('r1')).name, 'from-x')
    })

    it('R05b 刪除之同批重複主鍵(真ORM, mustExist): 整批拒絕且零刪除; getRejectKey可統一取得兩種reject形狀之拒收鍵', async function() {
        await proc('save', [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }])
        let err = await quiet(() => getReject(proc('del', [{ id: 'r1' }, { id: 'r1' }], { mustExist: true })))
        assert.strict.equal(err, 'invalid input of del, duplicate id: data[1]')
        assert.strict.equal((await sel()).length, 2, '零刪除')
        //字串reject(procOrm)與Error reject(guardWrite)之拒收鍵
        let e1 = await quiet(() => getReject(proc('del', [{ id: 'ghost' }], { mustExist: true })))
        assert.strict.equal(getRejectKey(e1), 'rowNotFound')
        let e2 = await quiet(() => getReject(so.guardWrite({ tables: ['items'], read: () => sel(), baseline: [['r1', 'h2:0123456789abcd']], contract: CT, write: async () => 1 })))
        assert.strict.equal(getRejectKey(e2), 'baselineFormat')
        let e3 = await quiet(() => getReject(so.guardWrite({
            tables: ['items'],
            read: async () => {
                throw new Error('plain failure')
            },
            write: async () => 1
        })))
        assert.strict.equal(getRejectKey(e3), null)
    })

    it('R15 V8之參考流程(整表存檔, 真ORM): 刪除集合＝基準內且在scope內之id − 送出之id, 他人載入後新增之範圍外列不被刪; 若誤用「庫內全部 − 送出」則會刪到(說明正確作法)', async function() {
        let CS = { table: 'items', pk: 'id', fields: ['name'], scope: (r) => r.isApp === 'y' }
        await proc('save', [
            { id: 't1', name: 'app1', isApp: 'y' }, { id: 't2', name: 'app2', isApp: 'y' }, { id: 's1', name: 'sess1', isApp: 'n' },
        ])
        let loaded = await sel()
        let bl = buildBaseline(loaded, CS)
        assert.deepStrictEqual(bl.map((v) => v[0]), ['t1', 't2'])
        await proc('save', [{ id: 's2', name: 'sess-after-load', isApp: 'n' }]) //載入後他人登入新增(範圍外)

        let sent = [{ id: 't1', name: 'app1-edited', isApp: 'y' }] //管理員存檔: 改 t1, 刪 t2
        let write = (delIds) => async () => procOrm2('items', { diff: sent, del: delIds.map((id) => ({ id })) })
        let procOrm2 = (tab, input) => so.procOrm('admin', tab, 'mix', input)

        //錯誤作法(對照): 庫內全部 − 送出 → 刪到 s1、s2
        let wrongDel = (await sel()).map((v) => v.id).filter((id) => !sent.some((s) => s.id === id))
        assert.deepStrictEqual(wrongDel.sort(), ['s1', 's2', 't2'], '錯誤作法會把範圍外之列算入刪除集合')

        //正確作法: 基準內 − 送出
        let rightDel = bl.map((v) => v[0]).filter((id) => !sent.some((s) => s.id === id))
        assert.deepStrictEqual(rightDel, ['t2'])
        await so.guardWrite({ tables: ['items'], read: () => sel(), baseline: bl, contract: CS, write: write(rightDel) })
        let left = (await sel()).map((v) => v.id).sort()
        assert.deepStrictEqual(left, ['s1', 's2', 't1'])
        assert.strict.equal((await byId('t1')).name, 'app1-edited')

        //載入後他人新增範圍內之列 → 整次拒收
        let bl2 = buildBaseline(await sel(), CS)
        await proc('save', [{ id: 't9', name: 'app9', isApp: 'y' }])
        let e = await quiet(() => getReject(so.guardWrite({ tables: ['items'], read: () => sel(), baseline: bl2, contract: CS, write: write([]) })))
        assert.strict.equal(e.key, 'baselineMismatch')
        assert.deepStrictEqual(e.added, ['t9'])
    })

    it('R14 大批(真ORM): 超過共用條件檢核之$in上限(10000)之列數, 存在檢查分批仍可修改; 缺一列者零寫入', async function() {
        this.timeout(120000)
        let rows = []
        for (let i = 0; i < 10500; i++) {
            rows.push({ id: `id-${i}`, name: 'A', order: i })
        }
        await proc('save', rows)
        let r = await proc('save', rows.map((v) => ({ id: v.id, name: 'B' })), { mustExist: true })
        assert.strict.equal(r.length, 10500)
        assert.strict.equal((await byId('id-10499')).name, 'B')
        let err = await quiet(() => getReject(proc('save', [...rows.map((v) => ({ id: v.id, name: 'C' })), { id: 'ghost', name: 'C' }], { mustExist: true })))
        assert.strict.equal(err, 'rowNotFound')
        assert.strict.equal((await byId('id-0')).name, 'B', '零寫入')
    })

    it('R13 多表取鎖(真ORM): 交錯之兩組多表guardWrite不死結, 且各自之寫入完整', async function() {
        await so.procOrm('u', 'items', 'save', [{ id: 'r1', name: 'A', order: 1 }])
        await so.procOrm('u', 'items2', 'save', [{ id: 'q1', name: 'Q', order: 1 }])
        let bl = buildBaseline(await sel(), CT)
        let job = (tables, name) => so.guardWrite({
            tables,
            read: () => sel(),
            baseline: bl,
            contract: CT,
            write: async () => {
                await so.procOrm('u', 'items2', 'save', [{ id: 'q1', name }], { mustExist: true })
                await wait(20)
                return name
            },
        })
        let t = setTimeout(() => assert.fail('疑似死結'), 5000)
        let rs = await Promise.all([job(['items', 'items2'], 'n1'), job(['items2', 'items'], 'n2')])
        clearTimeout(t)
        assert.deepStrictEqual(rs, ['n1', 'n2'])
        assert.strict.equal((await byId('q1', 'items2')).name, 'n2')
    })

})
