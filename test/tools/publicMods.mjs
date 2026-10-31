//公開子模組清單之單一來源檢核(R-PUBMOD-01): README〈公開子模組〉段之表為清單之單一來源, 本檔把表解析成結構並與 src/*.mjs 實際檔案比對
//純函數、不讀檔(README 文字與檔案清單由呼叫端給), 使 unit-publicmods 能以變異過之 README 文字驗證檢核本身會判紅
//表格式(欄內不得含直立線): 公開表 `| \`src/檔.mjs\` | \`w-serv-orm/src/檔.mjs\` | \`匯出名\`、... | 用途 | 穩定性承諾 |`, 內部檔表 `| \`src/檔.mjs\` | 不公開之理由 |`
//兩表分別置於標題含「公開(可深層匯入)」與「內部檔」之 ### 小節下


const HEAD_SECTION = '## 公開子模組'
const HEAD_PUBLIC = '公開(可深層匯入)'
const HEAD_INTERNAL = '內部檔'


function getSection(md) {
    //自 `## 公開子模組` 起至下一個 `## `(同階標題)前
    let lines = String(md).split(/\r?\n/)
    let i = lines.findIndex((l) => l.startsWith(HEAD_SECTION))
    if (i < 0) {
        return null
    }
    let j = lines.findIndex((l, k) => k > i && /^## /.test(l))
    return lines.slice(i, j < 0 ? lines.length : j)
}


function parseReadmeMods(md) {
    let sec = getSection(md)
    if (sec === null) {
        return null
    }
    let out = { public: [], internal: [] }
    let kind = ''
    for (let l of sec) {
        if (/^### /.test(l)) {
            kind = l.includes(HEAD_INTERNAL) ? 'internal' : l.includes(HEAD_PUBLIC) ? 'public' : ''
            continue
        }
        if (kind === '' || !l.startsWith('|')) {
            continue
        }
        let cs = l.split('|').slice(1, -1).map((v) => v.trim())
        let m = /^`src\/([A-Za-z]+\.mjs)`$/.exec(cs[0] || '')
        if (m === null) {
            continue //表頭與分隔列
        }
        if (kind === 'public') {
            out.public.push({
                file: m[1],
                importPath: (/^`([^`]+)`$/.exec(cs[1] || '') || [])[1] || '',
                exports: [...(cs[2] || '').matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((v) => v[1]),
                nCells: cs.length,
            })
        }
        else {
            out.internal.push({ file: m[1], reason: cs[1] || '' })
        }
    }
    return out
}


function checkMods(parsed, files) {
    //回問題清單(空陣列為合格): 缺段、重複、公開與內部重疊、檔案未歸類、表列無對應檔、匯入路徑錯、匯出欄空
    if (parsed === null) {
        return ['README 缺〈公開子模組〉段']
    }
    let ps = []
    let pub = parsed.public.map((v) => v.file)
    let int = parsed.internal.map((v) => v.file)
    if (pub.length === 0) {
        ps.push('公開表無任何列')
    }
    for (let [name, a] of [['公開表', pub], ['內部檔表', int]]) {
        for (let f of new Set(a.filter((v, k) => a.indexOf(v) !== k))) {
            ps.push(`${name}重複列出 ${f}`)
        }
    }
    for (let f of pub.filter((v) => int.includes(v))) {
        ps.push(`${f} 同時列於公開表與內部檔表`)
    }
    let all = new Set([...pub, ...int])
    for (let f of files.filter((v) => !all.has(v))) {
        ps.push(`src/${f} 未歸類(須列入公開表或內部檔表)`)
    }
    for (let f of [...all].filter((v) => !files.includes(v))) {
        ps.push(`表列之 src/${f} 不存在`)
    }
    for (let r of parsed.public) {
        if (r.importPath !== `w-serv-orm/src/${r.file}`) {
            ps.push(`${r.file} 之匯入路徑應為 w-serv-orm/src/${r.file}, 實為 ${r.importPath}`)
        }
        if (r.exports.length === 0) {
            ps.push(`${r.file} 之匯出欄為空`)
        }
        if (r.nCells !== 5) {
            ps.push(`${r.file} 之公開表列應有 5 欄(檔、匯入路徑、匯出、用途、穩定性承諾), 實為 ${r.nCells}`)
        }
    }
    for (let r of parsed.internal) {
        if (r.reason === '') {
            ps.push(`${r.file} 之內部檔列未寫理由`)
        }
    }
    return ps
}


export { parseReadmeMods, checkMods }
