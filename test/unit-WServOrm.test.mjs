import assert from 'assert'
import WServOrm from '../src/WServOrm.mjs'
import getMapOrm from '../src/getMapOrm.mjs'
import getProc from '../src/getProc.mjs'
import checkOptRemoved from '../src/checkOptRemoved.mjs'


//替身ORM工廠: 以name辨識所屬實例, 呼叫紀錄寫入log; 回傳形狀依w-orm系列規格(save、del回逐筆陣列, insert回聚合物件)
function mkWOrm(name, log, behavior = {}) {
    return function() {
        let ev = {}
        for (let fn of ['select', 'insert', 'save', 'del', 'delAll']) {
            ev[fn] = async (data) => {
                log.push({ name, fn, data })
                if (behavior[fn]) {
                    return behavior[fn](data)
                }
                if (fn === 'select') {
                    return [{ id: `${name}-r1`, isActive: 'n' }, { id: `${name}-r2`, isActive: 'y' }]
                }
                if (fn === 'save' || fn === 'del') {
                    return (Array.isArray(data) ? data : [data]).map(() => ({ n: 1, ok: 1 }))
                }
                return { n: 1, nInserted: 1, ok: 1 }
            }
        }
        return ev
    }
}

let dsAll = { tests: { keys: ['id', 'name', 'isActive', 'timeUpdate'] } }
let dsNoTime = { tests: { keys: ['id', 'name', 'isActive'] } }
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

async function captureLog(fn) {
    let logs = []
    let logOrig = console.log
    console.log = (...args) => {
        logs.push(args)
    }
    try {
        await fn()
    }
    finally {
        console.log = logOrig
    }
    return logs
}


describe('WServOrm實例互不干擾', function() {

    it('I01 兩實例之procOrm各自路由至自己的ORM', async function() {
        //R1: 雙向皆打自己的ORM, 解構後呼叫亦然
        let log = []
        let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
        let B = WServOrm(dsAll, mkWOrm('B', log), 'url-b', 'db-b')
        let { procOrm: pA } = A
        let { procOrm: pB } = B
        await pA('u1', 'tests', 'select', {})
        await pB('u1', 'tests', 'select', {})
        await pA('u1', 'tests', 'save', [{ id: 'x' }])
        await pB('u1', 'tests', 'del', [{ id: 'y' }])
        assert.strict.deepEqual(log.map((v) => `${v.name}.${v.fn}`), ['A.select', 'B.select', 'A.save', 'B.del'])
    })

    it('I02 各實例依自己之ds調整數據', async function() {
        //R1: A之ds含timeUpdate而補值, B之ds不含而不補
        let log = []
        let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
        let B = WServOrm(dsNoTime, mkWOrm('B', log), 'url-b', 'db-b')
        await A.procOrm('u1', 'tests', 'save', [{ id: 'x' }])
        await B.procOrm('u1', 'tests', 'save', [{ id: 'y' }])
        assert.strict.deepEqual(log.map((v) => v.name), ['A', 'B'])
        assert.ok('timeUpdate' in log[0].data[0])
        assert.ok(!('timeUpdate' in log[1].data[0]))
    })

    it('I03 已移除之設定給予非預設值即建構拋錯且不建立ORM', async function() {
        //R3: useCheckUser、getUserById、useExcludeWhenNotAdmin已移除; 給予未給、null、false以外之值即拋錯, 避免使用端以為仍有檢查而無聲失去
        //拋錯於建立各資料表ORM之前, 否則已開啟之ORM(如lmdb之檔案)無從關閉; 亦不影響既有實例
        let log = []
        let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
        let created = 0
        let WOrmCount = function() {
            created++
            return {}
        }
        let bads = [
            ['useCheckUser', true],
            ['useCheckUser', 'true'],
            ['useCheckUser', 1],
            ['getUserById', async () => ({ isActive: 'y' })],
            ['getUserById', 'x'],
            ['useExcludeWhenNotAdmin', true],
            ['useExcludeWhenNotAdmin', 'n'],
        ]
        for (let [k, v] of bads) {
            assert.throws(() => WServOrm(dsAll, WOrmCount, 'url-x', 'db-x', { [k]: v }), (e) => e instanceof Error && e.message.startsWith(`opt.${k} has been removed, `), `${k}: ${String(v)}`)
        }
        assert.strict.equal(created, 0)
        let r = await A.procOrm('u1', 'tests', 'select', {})
        assert.strict.deepEqual(r.map((v) => v.id), ['A-r1', 'A-r2'])
    })

    it('I04 已移除之設定未給、null或false照常建構, 不檢查使用者亦不過濾', async function() {
        //R3: 四個使用端現行之設定({useCheckUser:false, getUserById:null, useExcludeWhenNotAdmin:false})升版照常可用
        //procOrm不做授權: userId不檢查(含空字串、null、undefined), select不依使用者濾除isActive為n者
        let opts = [undefined, null, {}, { useCheckUser: null }, { useCheckUser: false, getUserById: null, useExcludeWhenNotAdmin: false }]
        for (let opt of opts) {
            let X = WServOrm(dsAll, mkWOrm('X', []), 'url-x', 'db-x', opt)
            for (let userId of ['u1', '', null, undefined]) {
                let r = await X.procOrm(userId, 'tests', 'select', {})
                assert.strict.deepEqual(r.map((v) => v.id), ['X-r1', 'X-r2'], `opt ${JSON.stringify(opt)}, userId ${String(userId)}`)
            }
        }
    })

    it('I05 三種hook各自屬於所註冊之實例', async function() {
        //R1、R4: 雙向隔離; 註冊並等待超過1ms後生效
        let log = []
        let calls = []
        let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
        let B = WServOrm(dsAll, mkWOrm('B', log), 'url-b', 'db-b')
        for (let [name, ins] of [['A', A], ['B', B]]) {
            ins.addFunCheck(() => {
                calls.push(`${name}-check`)
            })
            ins.addFunPreProcessing((p) => {
                calls.push(`${name}-pre`)
                return p
            })
            ins.addFunPostProcessing((p) => {
                calls.push(`${name}-post`)
                return p.output
            })
        }
        await wait(20)
        await A.procOrm('u1', 'tests', 'select', {})
        assert.strict.deepEqual(calls, ['A-check', 'A-pre', 'A-post'])
        calls.length = 0
        await B.procOrm('u1', 'tests', 'select', {})
        assert.strict.deepEqual(calls, ['B-check', 'B-pre', 'B-post'])
    })

    it('I06 新建實例不繼承既有實例之hook', async function() {
        //R1d: A註冊後再建C, C之procOrm不呼叫A之hook
        let log = []
        let calls = []
        let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
        A.addFunCheck(() => {
            calls.push('A-check')
        })
        await wait(20)
        let C = WServOrm(dsAll, mkWOrm('C', log), 'url-c', 'db-c')
        await C.procOrm('u1', 'tests', 'select', {})
        assert.strict.deepEqual(calls, [])
    })

    it('I07 直接呼叫getMapOrm兩次各打自己的woItems', async function() {
        //R1c: 使用端直接import getMapOrm之用法, 回傳函數之參數形狀不變
        let log = []
        let mk = (name) => ({
            tests: {
                select: async () => {
                    log.push(name)
                    return []
                },
            },
        })
        let m1 = getMapOrm(dsAll, mk('W1'))
        let m2 = getMapOrm(dsAll, mk('W2'))
        await m1('u1', 'tests', 'select', {})
        await m2('u1', 'tests', 'select', {})
        assert.strict.deepEqual(log, ['W1', 'W2'])
    })

    it('I08 擴充函數之參數不含isAdmin', async function() {
        //R3: 隨useCheckUser移除, 參數物件只含woName、userId、mode、input, 後處理另含output
        let A = WServOrm(dsAll, mkWOrm('A', []), 'url-a', 'db-a')
        let ks = {}
        A.addFunCheck((p) => {
            ks.check = Object.keys(p)
        })
        A.addFunPreProcessing((p) => {
            ks.pre = Object.keys(p)
            return p
        })
        A.addFunPostProcessing((p) => {
            ks.post = Object.keys(p)
            return p.output
        })
        await wait(20)
        await A.procOrm('u1', 'tests', 'select', {})
        assert.strict.deepEqual(ks, {
            check: ['woName', 'userId', 'mode', 'input'],
            pre: ['woName', 'userId', 'mode', 'input'],
            post: ['woName', 'userId', 'mode', 'input', 'output'],
        })
    })

    it('I09 呼叫進行中建立另一實例不影響該次呼叫', async function() {
        //R1a: A之check等待中建立B, A之呼叫仍打A之ORM
        let log = []
        let release = null
        let gate = new Promise((resolve) => {
            release = resolve
        })
        let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
        A.addFunCheck(async () => {
            await gate
        })
        await wait(20)
        let pA = A.procOrm('u1', 'tests', 'select', {})
        await wait(5)
        WServOrm(dsAll, mkWOrm('B', log), 'url-b', 'db-b')
        release()
        let rA = await pA
        assert.strict.deepEqual(log.map((v) => v.name), ['A'])
        assert.strict.deepEqual(rA.map((v) => v.id), ['A-r1', 'A-r2'])
    })

    it('I10 同一實例之woItems直寫與procOrm寫入打同一個ORM', async function() {
        //R1b: 使用端先以woItems直接寫入再經procOrm寫入之用法
        let log = []
        let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
        WServOrm(dsAll, mkWOrm('B', log), 'url-b', 'db-b')
        await A.woItems.tests.save([{ id: 'x' }])
        await A.procOrm('u1', 'tests', 'save', [{ id: 'y' }])
        assert.strict.deepEqual(log.map((v) => v.name), ['A', 'A'])
    })

    it('I11 回傳函數之名稱與型別不變', async function() {
        //R2: 使用端以解構取用並當裸函數傳遞; addFun*回傳undefined; procOrm為async函數
        let A = WServOrm(dsAll, mkWOrm('A', []), 'url-a', 'db-a')
        assert.strict.equal(A.procOrm.name, 'procOrm')
        assert.strict.equal(Object.prototype.toString.call(A.procOrm), '[object AsyncFunction]')
        for (let k of ['addFunCheck', 'addFunPreProcessing', 'addFunPostProcessing']) {
            assert.strict.equal(A[k].name, k)
            assert.strict.equal(A[k](() => {}), undefined)
        }
    })

    it('I12 直接呼叫getProc: 已移除之設定與無效之mapOrm皆拋Error, 未給、null或false照常', async function() {
        //R3: 使用端有以getMapOrm與getProc直接組出procOrm者(如w-web-sso之測試), 已移除之設定不得被靜默忽略, 訊息同WServOrm
        //建構期錯誤為Error, 不回rejected Promise(原回之Promise被解構時得undefined)
        let getThrow = (fn) => {
            try {
                fn()
            }
            catch (e) {
                return e
            }
            throw new Error('預期拋錯但未拋')
        }
        let mapOrm = getMapOrm(dsAll, { tests: { select: async () => [{ id: 'r1' }] } })
        let bads = [
            ['useCheckUser', true],
            ['getUserById', async () => ({ isActive: 'y' })],
            ['useExcludeWhenNotAdmin', true],
        ]
        for (let [k, v] of bads) {
            let e1 = getThrow(() => getProc(mapOrm, { [k]: v }))
            let e2 = getThrow(() => WServOrm(dsAll, mkWOrm('X', []), 'url-x', 'db-x', { [k]: v }))
            assert.ok(e1 instanceof Error && e1.message.startsWith(`opt.${k} has been removed, `), `${k}: ${String(v)}`)
            assert.strict.equal(e1.message, e2.message)
        }
        for (let bad of [undefined, null, {}, 'x']) {
            let e = getThrow(() => getProc(bad))
            assert.ok(e instanceof Error, String(bad))
            assert.strict.equal(e.message, 'invalid mapOrm')
        }
        for (let args of [[], [undefined], [null], [{}], [{ useCheckUser: false, getUserById: null, useExcludeWhenNotAdmin: false }]]) {
            let { procOrm } = getProc(mapOrm, ...args)
            let r = await procOrm('u1', 'tests', 'select', {})
            assert.strict.deepEqual(r, [{ id: 'r1' }], JSON.stringify(args))
        }
    })

    it('I13 checkOptRemoved可由使用端單獨呼叫: 只看已移除之三鍵, 其他鍵不受影響', async function() {
        //R3: 使用端包裝層(如WWebApi)以自身之opt呼叫, opt含serverPort等其他鍵; 通過時回undefined且不改動opt
        let optWrap = { serverPort: 11005, webName: { eng: 'x' }, useCheckUser: false, getUserById: null }
        assert.strict.equal(checkOptRemoved(optWrap), undefined)
        assert.strict.deepEqual(optWrap, { serverPort: 11005, webName: { eng: 'x' }, useCheckUser: false, getUserById: null })
        for (let opt of [undefined, null, {}, 'x', 1]) {
            assert.strict.equal(checkOptRemoved(opt), undefined, String(opt))
        }
        for (let k of ['useCheckUser', 'getUserById', 'useExcludeWhenNotAdmin']) {
            assert.throws(() => checkOptRemoved({ serverPort: 11005, [k]: true }), (e) => e instanceof Error && e.message.startsWith(`opt.${k} has been removed, `), k)
        }
    })

})


describe('procOrm後處理', function() {

    it('H01 逐筆失敗而reject時不執行後處理, 成功時執行', async function() {
        //R5: 後處理只在前面各階段皆成功後執行
        let log = []
        let calls = []
        let save = (d) => d.map((v, k) => (k === 1 ? { n: 1, ok: 0, err: 'E' } : { n: 1, ok: 1 }))
        let A = WServOrm(dsAll, mkWOrm('A', log, { save }), 'url-a', 'db-a')
        A.addFunPostProcessing((p) => {
            calls.push(p.mode)
            return p.output
        })
        await wait(20)
        let err = await getReject(A.procOrm('u1', 'tests', 'save', [{ id: 'a' }, { id: 'b' }]))
        assert.strict.equal(err, 'failed to save data: id[b]')
        assert.strict.deepEqual(calls, [])
        await A.procOrm('u1', 'tests', 'select', {})
        assert.strict.deepEqual(calls, ['select'])
    })

})


describe('mapOrm之log標籤與訊息', function() {

    it('L01 insert與mix之insert、del整批失敗之標籤', async function() {
        //R6: 標籤依實際操作, reject訊息為該操作之整批失敗訊息
        let log = []
        let fail = () => Promise.reject(new Error('E-batch'))
        let A = WServOrm(dsAll, mkWOrm('A', log, { insert: fail, del: fail }), 'url-a', 'db-a')
        let errs = []
        let logs = await captureLog(async () => {
            errs.push(await getReject(A.procOrm('u1', 'tests', 'insert', [{ id: 'a' }])))
            errs.push(await getReject(A.procOrm('u1', 'tests', 'mix', { add: [{ id: 'a' }] })))
            errs.push(await getReject(A.procOrm('u1', 'tests', 'mix', { del: [{ id: 'd' }] })))
        })
        assert.strict.deepEqual(errs, ['failed to insert data', 'failed to insert data', 'failed to delete data'])
        assert.strict.deepEqual(logs.map((v) => v[0]), ['tests.insert catch', 'tests.insert catch', 'tests.del catch'])
    })

    it('L02 adjustData失敗之標籤含表名', async function() {
        //R6: save、mix之add與diff三處adjustData失敗皆記表名, reject訊息為整批失敗訊息
        let log = []
        let A = WServOrm({ tests: {} }, mkWOrm('A', log), 'url-a', 'db-a')
        let errs = []
        let logs = await captureLog(async () => {
            errs.push(await getReject(A.procOrm('u1', 'tests', 'save', [{ id: 'a' }])))
            errs.push(await getReject(A.procOrm('u1', 'tests', 'mix', { add: [{ id: 'a' }] })))
            errs.push(await getReject(A.procOrm('u1', 'tests', 'mix', { diff: [{ id: 'a' }] })))
        })
        assert.strict.deepEqual(errs, ['failed to adjust data', 'failed to adjust data', 'failed to adjust data'])
        assert.strict.deepEqual(logs.map((v) => v[0]), ['tests.adjustData catch', 'tests.adjustData catch', 'tests.adjustData catch'])
    })

    it('T01 失敗筆主鍵超過100字元時訊息內截斷且log保留全文', async function() {
        //R7: 截為100字元(含「…」), 恰為100字元者不截斷
        let id150 = 'k'.repeat(150)
        let id100 = 'm'.repeat(100)
        let save = (d) => d.map(() => ({ n: 1, ok: 0, err: 'E' }))
        let A = WServOrm(dsAll, mkWOrm('A', [], { save }), 'url-a', 'db-a')
        let err1 = null
        let err2 = null
        let logs = await captureLog(async () => {
            err1 = await getReject(A.procOrm('u1', 'tests', 'save', [{ id: id150 }]))
            err2 = await getReject(A.procOrm('u1', 'tests', 'save', [{ id: id100 }]))
        })
        assert.strict.equal(err1, `failed to save data: id[${'k'.repeat(99)}…]`)
        assert.strict.equal(err2, `failed to save data: id[${id100}]`)
        assert.ok(JSON.stringify(logs).includes(id150))
    })

})


describe('procOrm補主鍵', function() {

    let isId = (v) => typeof v === 'string' && v.length > 0

    it('P01 insert、save、mix之新增未帶主鍵時補值並回傳', async function() {
        //D1: 本套件以genIDSeq補值, 回傳之id即ORM收到之id; 物件輸入回傳單一{id}
        let log = []
        let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
        let r1 = await A.procOrm('u1', 'tests', 'insert', [{ name: 'a' }])
        let r2 = await A.procOrm('u1', 'tests', 'save', { name: 'b' })
        let r3 = await A.procOrm('u1', 'tests', 'mix', { add: [{ name: 'c' }] })
        assert.ok(isId(r1[0].id) && isId(r2.id) && isId(r3[0].id))
        assert.strict.equal(log[0].data[0].id, r1[0].id)
        assert.strict.equal(log[1].data.id, r2.id)
        assert.strict.equal(log[2].data[0].id, r3[0].id)
    })

    it('P02 依主鍵值決定是否補值', async function() {
        //R-ID-01 規則1: null、空字串、物件補值, 非空字串保留; R-ID-02 規則2: 字串型(或型別未知)主鍵欄之有限數字轉為其字串形式
        let log = []
        let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
        let input = [{ id: null }, { id: '' }, { id: { x: 1 } }, { id: 123 }, { id: 'keep' }]
        let r = await A.procOrm('u1', 'tests', 'save', input)
        let got = log[0].data.map((v) => v.id)
        assert.ok(isId(got[0]) && isId(got[1]) && isId(got[2]))
        assert.strict.equal(got[3], '123')
        assert.strict.equal(got[4], 'keep')
        assert.strict.deepEqual(r.map((v) => v.id), got)
    })

    it('P03 schema判定主鍵欄與型別', async function() {
        //D1: 無id欄、id非pk、id型別非字串型者不補; settings標pk且為字串型者補
        let log = []
        let dsCases = [
            [{ tests: { keys: ['name'] } }, false],
            [{ tests: { keys: ['id', 'name'], settings: { id: { type: 'STRING' }, name: { type: 'STRING' } } } }, false],
            [{ tests: { keys: ['id', 'name'], settings: { id: { pk: true, type: 'INTEGER' }, name: { type: 'STRING' } } } }, false],
            [{ tests: { keys: ['id', 'name'], settings: { id: { pk: true, type: 'STRING' }, name: { type: 'STRING' } } } }, true],
            [{ tests: { keys: ['id', 'name'], settings: { id: { pk: true }, name: {} } } }, true],
        ]
        for (let [ds, expectGen] of dsCases) {
            log.length = 0
            let A = WServOrm(ds, mkWOrm('A', log), 'url-a', 'db-a')
            await A.procOrm('u1', 'tests', 'insert', [{ name: 'a' }])
            assert.strict.equal(isId(log[0].data[0].id), expectGen, JSON.stringify(ds))
        }
    })

    it('P04 單一空物件維持原樣交ORM', async function() {
        //D1: 調整後無欄位之列不補, 保留ORM視空物件為無效輸入之既有行為
        let log = []
        let A = WServOrm({ tests: { keys: ['id', 'name'] } }, mkWOrm('A', log), 'url-a', 'db-a')
        await A.procOrm('u1', 'tests', 'save', {})
        assert.strict.deepEqual(log[0].data, {})
    })

    it('P05 同批多筆各自補值且呼叫端原物件不被加上主鍵', async function() {
        //D1、D1a: 各自唯一; 補值寫在複本, 呼叫端原物件不含補出之主鍵
        let log = []
        let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
        let input = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
        let r = await A.procOrm('u1', 'tests', 'insert', input)
        let ids = r.map((v) => v.id)
        assert.strict.equal(new Set(ids).size, 3)
        assert.ok(input.every((v) => !('id' in v)))
    })

    it('P06 逐筆失敗之訊息以呼叫端視角列出且log含補出之主鍵', async function() {
        //X2: 呼叫端未帶主鍵者仍列第N筆, log保留補出之主鍵
        let log = []
        let save = (d) => d.map((v, k) => (k === 1 ? { n: 1, ok: 0, err: 'E' } : { n: 1, ok: 1 }))
        let A = WServOrm(dsAll, mkWOrm('A', log, { save }), 'url-a', 'db-a')
        let err = null
        let logs = await captureLog(async () => {
            err = await getReject(A.procOrm('u1', 'tests', 'save', [{ id: 's1' }, { name: 'no-id' }]))
        })
        assert.strict.equal(err, 'failed to save data: data[1]')
        assert.ok(JSON.stringify(logs).includes(log[0].data[1].id))
    })

})


describe('hook串接與註冊', function() {

    let dsTwo = { users: { keys: ['id', 'name'] }, items: { keys: ['id', 'name'] } }

    it('K01 多個模組各註冊一個後處理皆正確', async function() {
        //D3: 每個後處理皆收參數物件, output為前一個之回傳值
        let log = []
        let A = WServOrm(dsTwo, mkWOrm('A', log), 'url-a', 'db-a')
        A.addFunPostProcessing(({ woName, output }) => (woName !== 'users' ? output : output.map((v) => ({ ...v, tagA: 1 }))))
        A.addFunPostProcessing(({ woName, output }) => (woName !== 'items' ? output : output.map((v) => ({ ...v, tagB: 1 }))))
        await wait(20)
        let rU = await A.procOrm('u1', 'users', 'select', {})
        let rI = await A.procOrm('u1', 'items', 'select', {})
        assert.ok(rU.every((v) => v.tagA === 1 && !('tagB' in v)))
        assert.ok(rI.every((v) => v.tagB === 1 && !('tagA' in v)))
    })

    it('K02 後處理回傳undefined往下傳且拋錯即中止', async function() {
        //D3: 不加特例; 某個拋錯則procOrm reject且後續不執行
        let calls = []
        let A = WServOrm(dsAll, mkWOrm('A', []), 'url-a', 'db-a')
        A.addFunPostProcessing(() => undefined)
        A.addFunPostProcessing((p) => {
            calls.push(p.output)
            return p.output
        })
        await wait(20)
        let r = await A.procOrm('u1', 'tests', 'select', {})
        assert.strict.equal(r, undefined)
        assert.strict.deepEqual(calls, [undefined])
        let B = WServOrm(dsAll, mkWOrm('B', []), 'url-b', 'db-b')
        let after = []
        B.addFunPostProcessing(() => {
            throw new Error('E-post')
        })
        B.addFunPostProcessing((p) => {
            after.push(1)
            return p.output
        })
        await wait(20)
        let err = await getReject(B.procOrm('u1', 'tests', 'select', {}))
        assert.ok(String(err).includes('E-post'))
        assert.strict.deepEqual(after, [])
    })

    it('K03 多個前處理皆收完整參數物件', async function() {
        //P3-3: 前一個只回{input}時, 下一個仍收得到woName
        let log = []
        let seen = []
        let A = WServOrm(dsTwo, mkWOrm('A', log), 'url-a', 'db-a')
        A.addFunPreProcessing((p) => ({ input: p.input.map((v) => ({ ...v, preA: 1 })) }))
        A.addFunPreProcessing((p) => {
            seen.push(p.woName)
            return { ...p, input: p.input.map((v) => ({ ...v, preB: 1 })) }
        })
        await wait(20)
        await A.procOrm('u1', 'users', 'save', [{ id: 'x' }])
        assert.strict.deepEqual(seen, ['users'])
        assert.strict.equal(log[0].data[0].preA, 1)
        assert.strict.equal(log[0].data[0].preB, 1)
    })

    it('K04 前處理回傳非物件或缺input即reject且不呼叫ORM', async function() {
        //P3-3: 防止input成為undefined而令select回全表
        for (let bad of [undefined, [1], { woName: 'tests' }]) {
            let log = []
            let A = WServOrm(dsAll, mkWOrm('A', log), 'url-a', 'db-a')
            A.addFunPreProcessing(() => bad)
            await wait(20)
            let err = await getReject(A.procOrm('u1', 'tests', 'select', {}))
            assert.strict.equal(err, 'invalid return of pre-processing, need an object with input')
            assert.strict.deepEqual(log, [])
        }
    })

    it('K05 呼叫進行中註冊之後處理不套用於該次呼叫', async function() {
        //P3-1: 逐一呼叫前先取快照
        let release = null
        let gate = new Promise((resolve) => {
            release = resolve
        })
        let calls = []
        let A = WServOrm(dsAll, mkWOrm('A', []), 'url-a', 'db-a')
        A.addFunPostProcessing(async (p) => {
            calls.push('h1')
            await gate
            return p.output
        })
        await wait(20)
        let pm = A.procOrm('u1', 'tests', 'select', {})
        await wait(5)
        A.addFunPostProcessing((p) => {
            calls.push('h2')
            return p.output
        })
        await wait(20)
        release()
        await pm
        assert.strict.deepEqual(calls, ['h1'])
        await A.procOrm('u1', 'tests', 'select', {})
        assert.strict.deepEqual(calls, ['h1', 'h1', 'h2'])
    })

    it('K06 註冊非函數即同步拋錯, 函數與async函數可註冊', async function() {
        //D4: 訊息含hook名稱; 合法註冊之實例另建(A之check已因非函數註冊而被守門, 見K07)
        let A = WServOrm(dsAll, mkWOrm('A', []), 'url-a', 'db-a')
        for (let k of ['addFunCheck', 'addFunPreProcessing', 'addFunPostProcessing']) {
            for (let bad of [undefined, null, 'x', {}]) {
                assert.throws(() => A[k](bad), (e) => e instanceof Error && e.message.includes(k))
            }
        }
        let B = WServOrm(dsAll, mkWOrm('B', []), 'url-b', 'db-b')
        for (let k of ['addFunCheck', 'addFunPreProcessing', 'addFunPostProcessing']) {
            B[k](function(p) {
                return k === 'addFunCheck' ? undefined : (k === 'addFunPreProcessing' ? p : p.output)
            })
            B[k](async (p) => (k === 'addFunCheck' ? undefined : (k === 'addFunPreProcessing' ? p : p.output)))
        }
        await wait(20)
        let r = await B.procOrm('u1', 'tests', 'select', {})
        assert.strict.equal(r.length, 2)
    })

    it('K07 check註冊失敗被吞掉仍擋下呼叫, 前後處理則不影響', async function() {
        //P3-4: check維持fail-closed; 前後處理註冊失敗時陣列不變
        let A = WServOrm(dsAll, mkWOrm('A', []), 'url-a', 'db-a')
        try {
            A.addFunCheck(null)
        }
        catch (e) {}
        await wait(20)
        let err = await getReject(A.procOrm('u1', 'tests', 'select', {}))
        assert.ok(String(err).includes('addFunCheck'))
        //錯誤型別: 守門於procOrm內reject, 與procOrm其餘拒絕一致為字串
        assert.strict.equal(typeof err, 'string')
        let B = WServOrm(dsAll, mkWOrm('B', []), 'url-b', 'db-b')
        for (let k of ['addFunPreProcessing', 'addFunPostProcessing']) {
            try {
                B[k](null)
            }
            catch (e) {}
        }
        await wait(20)
        let r = await B.procOrm('u1', 'tests', 'select', {})
        assert.strict.equal(r.length, 2)
    })

})
