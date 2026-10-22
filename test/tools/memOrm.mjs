//記憶體ORM(供 unit-guard 使用): 有狀態之替身, 回傳形狀依w-orm系列規格(save、del回與輸入等長之逐筆陣列, insert與delAll回聚合物件)
//與 ormStub.mjs 之 createStub 不同: 本工具真的存取資料(Map), 並支援select之{ id: { $in } }、save之autoInsert選項、各操作之人為延遲與逐項覆寫(plan),
//用以驗證只改不增、刪除未命中與表鎖原子性; 每次createMemOrm各自持有tables、calls與plan, 不共用模組層狀態
function createMemOrm() {
    let tables = {} //cl -> Map(id -> row)
    let calls = [] //{ cl, fn, args }
    let plan = {
        delay: 0, //每個操作開始前之延遲毫秒
        select: null, //function(args, state)覆寫回傳或拋錯
        save: null,
        del: null,
    }
    let clone = (v) => JSON.parse(JSON.stringify(v))
    let wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    function WOrmMem({ cl }) {
        if (!tables[cl]) {
            tables[cl] = new Map()
        }
        let tb = tables[cl]
        let ev = {}

        ev.select = async (find) => {
            calls.push({ cl, fn: 'select', args: [find] })
            if (plan.delay > 0) {
                await wait(plan.delay)
            }
            if (plan.select) {
                return plan.select([find], tb)
            }
            let rows = [...tb.values()].map(clone)
            if (find && find.id && Array.isArray(find.id.$in)) {
                //同各w-orm-*共用之條件檢核(wsemi cvOrmFind): $in之元素數上限10000, 超過整批reject
                if (find.id.$in.length > 10000) {
                    return Promise.reject(new Error('invalid find: array is too large (> 10000) at [find.id.$in]'))
                }
                let ids = new Set(find.id.$in)
                rows = rows.filter((r) => ids.has(r.id))
            }
            return rows
        }

        ev.insert = async (data) => {
            calls.push({ cl, fn: 'insert', args: [data] })
            if (plan.delay > 0) {
                await wait(plan.delay)
            }
            let n = 0
            for (let v of (Array.isArray(data) ? data : [data])) {
                if (!tb.has(v.id)) {
                    tb.set(v.id, clone(v))
                    n++
                }
            }
            return { n, nInserted: n, ok: 1 }
        }

        ev.save = async (data, option) => {
            calls.push({ cl, fn: 'save', args: option === undefined ? [data] : [data, option] })
            if (plan.delay > 0) {
                await wait(plan.delay)
            }
            if (plan.save) {
                return plan.save([data, option], tb)
            }
            let autoInsert = !(option && option.autoInsert === false)
            return (Array.isArray(data) ? data : [data]).map((v) => {
                if (tb.has(v.id)) {
                    tb.set(v.id, { ...tb.get(v.id), ...clone(v) })
                    return { n: 1, nInserted: 0, nModified: 1, ok: 1 }
                }
                if (autoInsert) {
                    tb.set(v.id, clone(v))
                    return { n: 1, nInserted: 1, nModified: 0, ok: 1 }
                }
                return { n: 0, nInserted: 0, nModified: 0, ok: 1 }
            })
        }

        ev.del = async (data) => {
            calls.push({ cl, fn: 'del', args: [data] })
            if (plan.delay > 0) {
                await wait(plan.delay)
            }
            if (plan.del) {
                return plan.del([data], tb)
            }
            return (Array.isArray(data) ? data : [data]).map((v) => {
                let hit = tb.delete(v.id)
                return { n: hit ? 1 : 0, nDeleted: hit ? 1 : 0, ok: 1 }
            })
        }

        ev.delAll = async (find) => {
            calls.push({ cl, fn: 'delAll', args: [find] })
            let n = tb.size
            tb.clear()
            return { n, nDeleted: n, ok: 1 }
        }

        return ev
    }

    return {
        WOrmMem,
        tables,
        calls,
        plan,
        rows: (cl) => [...tables[cl].values()].map(clone),
        callsOf: (fn) => calls.filter((c) => c.fn === fn),
        reset: () => {
            calls.length = 0
            plan.delay = 0
            plan.select = null
            plan.save = null
            plan.del = null
        },
    }
}


export { createMemOrm }
