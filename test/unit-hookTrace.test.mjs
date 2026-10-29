import assert from 'assert'
import WServOrm from '../src/WServOrm.mjs'
import getProc from '../src/getProc.mjs'
import { createStub, getReject } from './tools/ormStub.mjs'
import { addHook, settle } from './tools/hookKit.mjs'


//規格: 計時器相關函數之觀察回調與測試(C:\opensrcOper\dspec\計時器相關函數之觀察回調與測試.md) P1-P4、§2 事件格式; 規則帳本 R-TRACE-01
//被測物: addFunCheck、addFunPreProcessing、addFunPostProcessing 之第2參數 opt.onTrace(src/getProc.mjs addFun, 註冊後延後1ms生效之計時器)
//事件: { type: 'active', hook: 'check'|'preProcessing'|'postProcessing', n: 該實例該類擴充函數生效後之總數 }, 於生效(已推入陣列)當下同步通知
//
//規格句對照:
//  HT01 §2「單一凍結物件{ type, ... }、其餘欄位為原始值、同步呼叫、不帶接收者」「函數釋放前才呼叫」  HT02 §2「欄位為JSDoc列舉之值」(n的計法)
//  HT03 §2「函數原行為不變」(註冊非函數之拋錯與守門)  HT04 P3「未傳觀察回調時, 對外行為、時序與效能與原版相同」
//  HT05-HT07 P4「回調不得影響被測函數: 拋錯被隔離、回傳值不使用、回傳之rejection忽略」  HT08 §2「單一擁有者wsemi getTrace」「非函數onTrace視同未給」
//  HT09 實作者補強(實例隔離)  HT10 實作者補強(生效順序等於註冊順序、回調內重入註冊)  HT11 getProc直接使用之路徑


let NAMES = [['addFunCheck', 'check'], ['addFunPreProcessing', 'preProcessing'], ['addFunPostProcessing', 'postProcessing']]
let KEYS = ['id', 'name']

function mkSo() {
    let stub = createStub()
    let so = WServOrm({ a: { keys: KEYS } }, stub.WOrmStub, './unused', 'db')
    return { so, stub }
}

//mkF, 依註冊函數名產生一個「被呼叫即計數且不改變結果」之擴充函數
function mkF(name, counter) {
    return (x) => {
        counter.n++
        if (name === 'addFunCheck') {
            return undefined
        }
        return name === 'addFunPreProcessing' ? { input: x.input } : x.output
    }
}

//flush, 讓出到下一個巨任務(setImmediate), 用於「unhandledRejection已被處理完」之屏障(不是時間等待)
let flush = () => new Promise((resolve) => setImmediate(resolve))


describe('addFunCheck、addFunPreProcessing、addFunPostProcessing 之 opt.onTrace(觀察回調)', function() {

    it('HT01 事件格式與生效時點: 三種函數各通知恰一次, 事件為凍結物件{ type, hook, n }且鍵集合精確, 回調不帶接收者, 註冊當下不通知, 通知當下該函數已生效', async function() {
        for (let [name, hook] of NAMES) {
            let { so } = mkSo()
            let evs = []
            let selves = []
            let counter = { n: 0 }
            let probe = null
            await new Promise((resolve) => {
                so[name](mkF(name, counter), {
                    onTrace: function(e) {
                        selves.push(this)
                        evs.push(e)
                        //通知當下發起procOrm: 若函數尚未生效, 其結果不會呼叫該函數
                        probe = so.procOrm('u1', 'a', 'select', {})
                        resolve()
                    },
                })
                assert.strict.equal(evs.length, 0, `${name} 註冊當下(同步區塊內)不通知`)
            })
            await probe
            assert.strict.equal(counter.n, 1, `${name} 通知當下函數已生效(被呼叫1次)`)
            await settle(so)
            assert.strict.equal(evs.length, 1, `${name} 恰通知一次`)
            assert.deepStrictEqual(Object.keys(evs[0]).sort(), ['hook', 'n', 'type'], `${name} 鍵集合`)
            assert.deepStrictEqual({ ...evs[0] }, { type: 'active', hook, n: 1 }, `${name} 內容`)
            assert.ok(Object.isFrozen(evs[0]), `${name} 事件已凍結`)
            assert.strict.equal(selves[0], undefined, `${name} 不帶接收者`)
        }
    })

    it('HT02 n為該實例該類擴充函數生效後之總數: 逐次遞增, 各類互不影響, 各實例互不影響; addFunCheck註冊非函數留下之守門函數計入', async function() {
        let { so } = mkSo()
        let f = () => {}
        let p = (x) => x.output
        let e1 = await addHook(so, 'addFunPostProcessing', p)
        let e2 = await addHook(so, 'addFunPostProcessing', p)
        let e3 = await addHook(so, 'addFunPostProcessing', p)
        assert.deepStrictEqual([e1.n, e2.n, e3.n], [1, 2, 3])
        let ePre = await addHook(so, 'addFunPreProcessing', (x) => ({ input: x.input }))
        assert.strict.equal(ePre.n, 1, '前處理另計')
        let eChk = await addHook(so, 'addFunCheck', f)
        assert.strict.equal(eChk.n, 1, '檢查另計')
        //註冊非函數: 拋錯, 並推入恆reject之守門函數(令該實例procOrm一律reject), 其後有效之check的n含守門函數
        let { so: so2 } = mkSo()
        assert.throws(() => so2.addFunCheck(null), (e) => e instanceof Error && e.message.includes('addFunCheck'))
        let eGuard = await addHook(so2, 'addFunCheck', f)
        assert.strict.equal(eGuard.hook, 'check')
        assert.strict.equal(eGuard.n, 2, '守門函數(1)+新註冊(1)')
        //他實例: 重新自1起
        let { so: so3 } = mkSo()
        assert.strict.equal((await addHook(so3, 'addFunPostProcessing', p)).n, 1)
    })

    it('HT03 註冊非函數: 仍同步拋同一Error(訊息含函數名)且不通知; addFunCheck仍留下守門函數令procOrm一律reject, 前後處理不留任何東西', async function() {
        let evs = []
        let opt = { onTrace: (e) => evs.push(e) }
        for (let [name] of NAMES) {
            let { so } = mkSo()
            for (let bad of [undefined, null, 'x', 123, {}, []]) {
                assert.throws(() => so[name](bad, opt), (e) => e instanceof Error && e.message === `${name} needs a function, but got ${typeof bad}`, `${name} ${String(bad)}`)
            }
            await settle(so) //註冊失敗不應排定任何生效
            assert.strict.equal(evs.length, 0, `${name} 註冊非函數不通知`)
            let pm = so.procOrm('u1', 'a', 'select', {})
            if (name === 'addFunCheck') {
                let err = await getReject(pm)
                assert.strict.equal(typeof err, 'string')
                assert.ok(err.includes('addFunCheck'), err)
            }
            else {
                assert.ok(Array.isArray(await pm), `${name} 註冊失敗不影響procOrm`)
            }
        }
    })

    it('HT04 P3 未傳onTrace時行為不變: opt為未給、null、空物件、onTrace為undefined/null、被Array.forEach多帶之參數(索引與陣列)時, 註冊照常生效', async function() {
        let variants = [
            ['未給', []],
            ['undefined', [undefined]],
            ['null', [null]],
            ['空物件', [{}]],
            ['onTrace=undefined', [{ onTrace: undefined }]],
            ['onTrace=null', [{ onTrace: null }]],
            ['onTrace=其他欄位', [{ other: 1 }]],
            ['索引(forEach第2參數)', [0]],
            ['陣列(forEach第3參數)', [[1, 2]]],
        ]
        for (let [name] of NAMES) {
            for (let [lab, args] of variants) {
                let { so } = mkSo()
                let counter = { n: 0 }
                let r = so[name](mkF(name, counter), ...args)
                assert.strict.equal(r, undefined, `${name} ${lab} 回傳undefined`)
                await settle(so)
                await so.procOrm('u1', 'a', 'select', {})
                assert.strict.equal(counter.n, 1, `${name} ${lab} 已生效`)
            }
        }
        //Array.prototype.forEach直接當回調傳入: (f, index, array)
        let { so } = mkSo()
        let counter = { n: 0 }
        let fs = [mkF('addFunPostProcessing', counter), mkF('addFunPostProcessing', counter)]
        fs.forEach(so.addFunPostProcessing)
        await settle(so)
        await so.procOrm('u1', 'a', 'select', {})
        assert.strict.equal(counter.n, 2, 'forEach直接傳入, 兩個皆生效')
    })

    it('HT05 P4 回調同步拋錯: 不影響註冊與procOrm, 不使行程崩潰(含試圖改寫凍結事件而拋TypeError), 其後註冊之函數照常依序生效', async function() {
        for (let [name] of NAMES) {
            let { so } = mkSo()
            let order = []
            let evs = []
            let f1 = (x) => {
                order.push('f1')
                return name === 'addFunCheck' ? undefined : (name === 'addFunPreProcessing' ? { input: x.input } : x.output)
            }
            let f2 = (x) => {
                order.push('f2')
                return name === 'addFunCheck' ? undefined : (name === 'addFunPreProcessing' ? { input: x.input } : x.output)
            }
            so[name](f1, {
                onTrace: (e) => {
                    evs.push(e)
                    e.n = 99 //凍結事件之改寫: 嚴格模式下拋TypeError, 亦被隔離
                },
            })
            so[name](f2, {
                onTrace: (e) => {
                    evs.push(e)
                    throw new Error('boom-trace')
                },
            })
            await settle(so)
            await so.procOrm('u1', 'a', 'select', {})
            assert.deepStrictEqual(order, ['f1', 'f2'], `${name} 兩個函數皆生效且依註冊順序`)
            assert.deepStrictEqual(evs.map((e) => e.n), [1, 2], `${name} 回調拋錯不改變事件內容(凍結)`)
        }
    })

    it('HT06 P4 回調回傳rejection或async函數拋錯: 一律忽略, 不產生unhandledRejection, 不影響註冊與procOrm', async function() {
        let unhandled = []
        let h = (e) => {
            unhandled.push(e)
        }
        process.on('unhandledRejection', h)
        try {
            for (let [name] of NAMES) {
                let { so } = mkSo()
                let counter = { n: 0 }
                so[name](mkF(name, counter), { onTrace: () => Promise.reject(new Error('rej-1')) })
                so[name](mkF(name, counter), {
                    onTrace: async () => {
                        throw new Error('rej-2')
                    },
                })
                so[name](mkF(name, counter), { onTrace: () => ({ then: undefined, catch: undefined }) })
                await settle(so)
                await flush()
                await so.procOrm('u1', 'a', 'select', {})
                assert.strict.equal(counter.n, 3, `${name} 三個函數皆生效`)
            }
            await flush()
        }
        finally {
            process.off('unhandledRejection', h)
        }
        assert.deepStrictEqual(unhandled, [], '無unhandledRejection')
    })

    it('HT07 P4 回調之回傳值不使用: 回傳任何值(false、物件、字串、Promise)皆不改變註冊結果', async function() {
        for (let [name] of NAMES) {
            let { so } = mkSo()
            let counter = { n: 0 }
            for (let ret of [false, 0, '', { ok: false }, 'x', Promise.resolve(false)]) {
                so[name](mkF(name, counter), { onTrace: () => ret })
            }
            await settle(so)
            await so.procOrm('u1', 'a', 'select', {})
            assert.strict.equal(counter.n, 6, `${name} 六個函數皆生效`)
        }
    })

    it('HT08 onTrace為非函數(字串、數字、物件、布林、Symbol)視同未給, 不拋錯、不通知, 註冊照常生效', async function() {
        for (let [name] of NAMES) {
            let { so } = mkSo()
            let counter = { n: 0 }
            for (let bad of ['x', 1, {}, true, Symbol('t'), [], new Date(0)]) {
                so[name](mkF(name, counter), { onTrace: bad })
            }
            await settle(so)
            await so.procOrm('u1', 'a', 'select', {})
            assert.strict.equal(counter.n, 7, `${name} 七個函數皆生效`)
        }
    })

    it('HT09 實例隔離: 各實例之回調只收自己註冊之事件, n各自計數', async function() {
        let A = mkSo().so
        let B = mkSo().so
        let evA = []
        let evB = []
        let p = (x) => x.output
        A.addFunPostProcessing(p, { onTrace: (e) => evA.push(e) })
        B.addFunPostProcessing(p, { onTrace: (e) => evB.push(e) })
        A.addFunPostProcessing(p, { onTrace: (e) => evA.push(e) })
        await Promise.all([settle(A), settle(B)])
        assert.deepStrictEqual(evA.map((e) => [e.hook, e.n]), [['postProcessing', 1], ['postProcessing', 2]])
        assert.deepStrictEqual(evB.map((e) => [e.hook, e.n]), [['postProcessing', 1]])
    })

    it('HT10 生效順序等於註冊順序; 回調內可再註冊(重入)而不死結, 後註冊者於其後生效', async function() {
        let { so } = mkSo()
        let order = []
        let evs = []
        let mk = (tag) => (x) => {
            order.push(tag)
            return x.output
        }
        let pmInner = null
        so.addFunPostProcessing(mk('p1'), {
            onTrace: (e) => {
                evs.push(`p1:${e.n}`)
                //回調內再註冊
                pmInner = addHook(so, 'addFunPostProcessing', mk('p3')).then((e3) => evs.push(`p3:${e3.n}`))
            },
        })
        so.addFunPostProcessing(mk('p2'), { onTrace: (e) => evs.push(`p2:${e.n}`) })
        await settle(so)
        await pmInner
        await so.procOrm('u1', 'a', 'select', {})
        assert.deepStrictEqual(evs, ['p1:1', 'p2:2', 'p3:3'])
        assert.deepStrictEqual(order, ['p1', 'p2', 'p3'])
    })

    it('HT11 直接使用getProc(不經WServOrm)亦同: 三種函數之第2參數opt.onTrace, 事件內容同', async function() {
        let calls = []
        let mapOrm = async (userId, woName, mode, input) => {
            calls.push([woName, mode])
            return []
        }
        let proc = getProc(mapOrm)
        let counter = { n: 0 }
        for (let [name, hook] of NAMES) {
            let e = await new Promise((resolve) => {
                proc[name](mkF(name, counter), { onTrace: resolve })
            })
            assert.deepStrictEqual({ ...e }, { type: 'active', hook, n: 1 }, name)
        }
        assert.deepStrictEqual(await proc.procOrm('u1', 'a', 'select', {}), [], 'procOrm照常')
        assert.strict.equal(counter.n, 3, '三種函數皆生效')
        assert.deepStrictEqual(calls, [['a', 'select']])
    })

})
