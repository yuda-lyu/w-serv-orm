import { isDeepStrictEqual } from 'util'
import assert from 'assert'


//替身ORM與測試共用小工具(供 unit-objcopy、api-objcopy 使用): 每次createStub各自持有calls與plan, 不共用模組層狀態
//替身ORM記錄收到之數據, 回傳形狀依w-orm系列規格: save、del回與輸入等長之逐筆陣列, insert與delAll回聚合物件; plan可覆寫各函數之回傳
function createStub() {
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
    return {
        WOrmStub,
        calls,
        reset: () => {
            calls.length = 0
            for (let k of Object.keys(plan)) {
                delete plan[k]
            }
        },
    }
}


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


//protoDiff: isDeepStrictEqual對原型之比較不完整(實測 Node 24: {__proto__:{name:'x'},id:'a'} 與 {id:'a'} 視為相等, 而這正是複本以r[k]=v建立時原型被換掉之症狀),
//故於兩者已深度相等後逐層補比原型; 有差異回傳該層路徑, 無則回傳null
function protoDiff(a, b, path = '') {
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return null
    }
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
        return path === '' ? '(根)' : path
    }
    for (let k of Object.keys(a)) {
        let r = protoDiff(a[k], b[k], `${path}.${k}`)
        if (r !== null) {
            return r
        }
    }
    return null
}


//same: 深度嚴格相等且各層原型相同, 失敗時只印標籤與簡短摘要(輸入含上百萬鍵之物件時, assert.deepStrictEqual之差異輸出會癱瘓測試)
function same(actual, expected, label = '') {
    let ok = isDeepStrictEqual(actual, expected)
    if (ok) {
        let p = protoDiff(actual, expected)
        if (p !== null) {
            assert.fail(`${label} 原型不同於 ${p}`)
        }
    }
    if (!ok) {
        let short = (v) => {
            let c
            try {
                c = typeof v === 'function' ? String(v) : JSON.stringify(v, (k, x) => (x === undefined ? '__undefined__' : x))
            }
            catch (e) {
                c = String(v)
            }
            return c === undefined ? String(v) : c.slice(0, 200)
        }
        assert.fail(`${label} 不相等: 實得 ${short(actual)} / 預期 ${short(expected)}`)
    }
}


export { createStub, getReject, quiet, same }
