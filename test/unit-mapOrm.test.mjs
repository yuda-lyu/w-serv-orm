import assert from 'assert'
import WServOrm from '../src/WServOrm.mjs'
import genTestData from '../src/genTestData.mjs'


//替身ORM, 回傳形狀依w-orm系列規格(資料庫函數回傳定義計算.md T2、T4):
//save與del回傳與輸入等長保序之逐筆陣列, 單筆失敗時整批仍resolve, 該筆以ok為0並附err回報; 整批性錯誤則reject
let plan = {}
let calls = []
function WOrmStub() {
    let ev = {}
    for (let fn of ['select', 'insert', 'save', 'del', 'delAll']) {
        ev[fn] = async (data) => {
            calls.push({ fn, data })
            return plan[fn](data)
        }
    }
    return ev
}

let ds = {
    tests: {
        keys: ['id', 'name', 'timeCreate', 'timeUpdate'],
    },
}

let okSave = { n: 1, nInserted: 0, nModified: 1, ok: 1 }
let okDel = { n: 1, nDeleted: 1, ok: 1 }

async function getReject(pm) {
    try {
        await pm
    }
    catch (err) {
        return err
    }
    throw new Error('預期reject但resolve')
}


describe('mapOrm逐筆失敗', function() {

    let so = WServOrm(ds, WOrmStub, 'stub-url', 'stub-db', { useCheckUser: false, useExcludeWhenNotAdmin: false })
    let proc = (mode, input) => so.procOrm('u1', 'tests', mode, input)

    beforeEach(function() {
        plan = {}
        calls = []
    })

    it('U01 save陣列全部成功', async function() {
        //R04: 全部成功時save回傳不變, 僅回傳id
        plan.save = (data) => data.map(() => okSave)
        let r = await proc('save', [{ id: 's1', name: 'a' }, { id: 's2', name: 'b' }])
        assert.strict.deepEqual(r, [{ id: 's1' }, { id: 's2' }])
    })

    it('U02 save物件全部成功', async function() {
        //R04: 輸入為單一物件時回傳單一{id}
        plan.save = () => [okSave]
        let r = await proc('save', { id: 's1', name: 'a' })
        assert.strict.deepEqual(r, { id: 's1' })
    })

    it('U03 save陣列中一筆ok為0', async function() {
        //R01: 逐筆ok為0即reject, 訊息帶失敗筆之主鍵, 不含成功筆
        plan.save = () => [okSave, { n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'E-save' }]
        let err = await getReject(proc('save', [{ id: 's1' }, { id: 's2' }]))
        assert.strict.equal(err, '儲存資料失敗: id[s2]')
    })

    it('U04 save物件ok為0', async function() {
        //R01: 輸入為單一物件時ORM回傳長度為1之陣列, 仍須檢出
        plan.save = () => [{ n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'E-save' }]
        let err = await getReject(proc('save', { id: 's1' }))
        assert.strict.equal(err, '儲存資料失敗: id[s1]')
    })

    it('U05 save未帶主鍵之筆ok為0且無err', async function() {
        //R01: 無有效主鍵者以輸入位置標示; R07: ok為0而無err(舊版ORM)仍判失敗
        plan.save = () => [okSave, { n: 1, ok: 0 }]
        let err = await getReject(proc('save', [{ id: 's1' }, { name: 'no-id' }]))
        assert.strict.equal(err, '儲存資料失敗: 第2筆')
    })

    it('U06 save整批reject', async function() {
        //R05: 整批性錯誤之訊息不變
        plan.save = () => Promise.reject(new Error('E-batch'))
        let err = await getReject(proc('save', [{ id: 's1' }]))
        assert.strict.equal(err, '儲存資料失敗')
    })

    it('U07 save之ORM回傳非陣列', async function() {
        //R07: 未依規格之ORM回傳非陣列時不檢查, 照舊回傳id
        plan.save = () => ({ n: 1, ok: 1 })
        let r = await proc('save', [{ id: 's1' }])
        assert.strict.deepEqual(r, [{ id: 's1' }])
    })

    it('U08 save多筆ok為0', async function() {
        //R08: 失敗筆數超過10筆時僅列前10筆並附總筆數
        let input = []
        for (let i = 1; i <= 12; i++) {
            input.push({ id: `f${i}` })
        }
        plan.save = (data) => data.map(() => ({ n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'E-full' }))
        let err = await getReject(proc('save', input))
        let ids = input.slice(0, 10).map((v) => `id[${v.id}]`).join(', ')
        assert.strict.equal(err, `儲存資料失敗: ${ids}等共12筆`)
    })

    it('U09 del全部成功含主鍵未命中', async function() {
        //R04: del回傳ORM原始逐筆陣列不變; 主鍵未命中(n為0、ok為1)屬正常結果而非失敗
        let rs = [okDel, { n: 0, nDeleted: 0, ok: 1 }]
        plan.del = () => rs
        let r = await proc('del', [{ id: 'd1' }, { id: 'd-none' }])
        assert.strict.deepEqual(r, rs)
    })

    it('U10 del數字主鍵ok為0', async function() {
        //R02: del逐筆ok為0即reject; 數字主鍵照列
        plan.del = () => [okDel, { n: 0, nDeleted: 0, ok: 0, err: 'can not delete by invalid id[123]' }]
        let err = await getReject(proc('del', [{ id: 'd1' }, { id: 123 }]))
        assert.strict.equal(err, '刪除資料失敗: id[123]')
    })

    it('U10b del物件輸入ok為0且無err', async function() {
        //R02: 物件輸入亦須檢出; R07: ok為0而無err仍判失敗
        plan.del = () => [{ n: 1, nDeleted: 0, ok: 0 }]
        let err = await getReject(proc('del', { id: 'd1' }))
        assert.strict.equal(err, '刪除資料失敗: id[d1]')
    })

    it('U11 del整批reject', async function() {
        //R05: 整批性錯誤之訊息不變
        plan.del = () => Promise.reject(new Error('E-batch'))
        let err = await getReject(proc('del', [{ id: 'd1' }]))
        assert.strict.equal(err, '刪除資料失敗')
    })

    it('U12 del之ORM回傳非陣列', async function() {
        //R07: 未依規格之ORM回傳非陣列時不檢查, 照舊回傳原值
        plan.del = () => ({ n: 1, nDeleted: 1, ok: 1 })
        let r = await proc('del', [{ id: 'd1' }])
        assert.strict.deepEqual(r, { n: 1, nDeleted: 1, ok: 1 })
    })

    it('U13 mix全部成功', async function() {
        //R04: mix依add、del、diff順序執行, 回傳累積之id
        plan.insert = (data) => ({ n: data.length, nInserted: data.length, ok: 1 })
        plan.del = (data) => data.map(() => okDel)
        plan.save = (data) => data.map(() => okSave)
        let r = await proc('mix', { add: [{ id: 'a1' }], del: [{ id: 'd1' }], diff: [{ id: 'f1' }] })
        assert.strict.deepEqual(r, [{ id: 'a1' }, { id: 'd1' }, { id: 'f1' }])
        assert.strict.deepEqual(calls.map((v) => v.fn), ['insert', 'del', 'save'])
    })

    it('U14 mix之del與diff皆有ok為0', async function() {
        //R03: 逐筆失敗不中斷後續步驟, 全部步驟完成後一次reject並分步列出
        plan.insert = (data) => ({ n: data.length, nInserted: data.length, ok: 1 })
        plan.del = () => [okDel, { n: 0, nDeleted: 0, ok: 0, err: 'E-del' }]
        plan.save = () => [{ n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'E-save' }]
        let err = await getReject(proc('mix', { add: [{ id: 'a1' }], del: [{ id: 'd1' }, { id: 'd2' }], diff: [{ id: 'f1' }] }))
        assert.strict.equal(err, '刪除資料失敗: id[d2]; 變更資料失敗: id[f1]')
        assert.strict.deepEqual(calls.map((v) => v.fn), ['insert', 'del', 'save'])
    })

    it('U15 mix僅del有ok為0', async function() {
        //R03: del之逐筆失敗不中斷diff, diff仍寫入, 最後reject僅列del之失敗
        plan.del = () => [{ n: 0, nDeleted: 0, ok: 0, err: 'E-del' }]
        plan.save = (data) => data.map(() => okSave)
        let err = await getReject(proc('mix', { del: [{ id: 'd1' }], diff: [{ id: 'f1' }] }))
        assert.strict.equal(err, '刪除資料失敗: id[d1]')
        assert.strict.deepEqual(calls.map((v) => v.fn), ['del', 'save'])
    })

    it('U16 mix之del整批reject', async function() {
        //R05: 整批性錯誤維持立即reject, 後續步驟不執行
        plan.del = () => Promise.reject(new Error('E-batch'))
        plan.save = (data) => data.map(() => okSave)
        let err = await getReject(proc('mix', { del: [{ id: 'd1' }], diff: [{ id: 'f1' }] }))
        assert.strict.equal(err, '刪除資料失敗')
        assert.strict.deepEqual(calls.map((v) => v.fn), ['del'])
    })

    it('U17 mix之add整批reject', async function() {
        //R05: insert整批性錯誤維持立即reject, 後續步驟不執行
        plan.insert = () => Promise.reject(new Error('E-batch'))
        plan.del = (data) => data.map(() => okDel)
        let err = await getReject(proc('mix', { add: [{ id: 'a1' }], del: [{ id: 'd1' }] }))
        assert.strict.equal(err, '新增資料失敗')
        assert.strict.deepEqual(calls.map((v) => v.fn), ['insert'])
    })

    it('U18 mix之del有ok為0後diff整批reject', async function() {
        //R05: 遇整批性錯誤即以該步驟之訊息reject, 先前之逐筆失敗已由log輸出
        plan.del = () => [{ n: 0, nDeleted: 0, ok: 0, err: 'E-del' }]
        plan.save = () => Promise.reject(new Error('E-batch'))
        let err = await getReject(proc('mix', { del: [{ id: 'd1' }], diff: [{ id: 'f1' }] }))
        assert.strict.equal(err, '變更資料失敗')
    })

    it('U19 insert成功', async function() {
        //R04: insert回傳聚合物件而非逐筆陣列, 照舊回傳id
        plan.insert = (data) => ({ n: data.length, nInserted: data.length, ok: 1 })
        let r = await proc('insert', [{ id: 'i1' }])
        assert.strict.deepEqual(r, [{ id: 'i1' }])
    })

    it('U22 錯誤原文寫入log而不進reject訊息', async function() {
        //R06: 前端訊息只帶主鍵, 錯誤原文由console.log輸出
        plan.save = () => [{ n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'E-secret-detail' }]
        let logs = []
        let logOrig = console.log
        console.log = (...args) => {
            logs.push(args)
        }
        let err
        try {
            err = await getReject(proc('save', [{ id: 's1' }]))
        }
        finally {
            console.log = logOrig
        }
        assert.ok(!String(err).includes('E-secret-detail'))
        assert.ok(JSON.stringify(logs).includes('E-secret-detail'))
    })

})


describe('genTestData逐筆失敗', function() {

    let dsGen = {
        tests: {
            funTest: () => [{ id: 'g1' }, { id: 'g2' }],
        },
    }

    it('U20 funTest全部成功', async function() {
        //R09: 全部成功時照舊resolve, 並以funTest產生之數據呼叫save
        let saved = null
        let woItems = {
            tests: {
                save: async (rs) => {
                    saved = rs
                    return rs.map(() => okSave)
                },
            },
        }
        await genTestData(dsGen, woItems, { mode: 'funTest', bLog: false })
        assert.strict.deepEqual(saved, [{ id: 'g1' }, { id: 'g2' }])
    })

    it('U21 funTest之save有ok為0', async function() {
        //R09: 逐筆ok為0即reject, 訊息含資料表名與錯誤原文(伺服器端開發工具)
        let woItems = {
            tests: {
                save: async () => [okSave, { n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'E-gen' }],
            },
        }
        let err = await getReject(genTestData(dsGen, woItems, { mode: 'funTest', bLog: false }))
        assert.ok(String(err).includes('tests'))
        assert.ok(String(err).includes('E-gen'))
        assert.ok(String(err).includes('g2'))
    })

})
