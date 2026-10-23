import fs from 'fs'
import path from 'path'
import assert from 'assert'


//R-ORM-RESULT-01(orm-run05): src內呼叫ORM實例方法之站點全集須已歸類; 新增站點(或改變某檔對某方法之呼叫數)時本案失敗, 須回帳本逐站判定「已檢查」或「不適用」後再更新此表
//盤點方式: 逐行去除註解後, 以正則取出「.方法(」之呼叫, 依(檔, 方法)計次; 計次而非行號, 避免無關修改使行號位移而誤報
let METHODS = ['select', 'selectByPk', 'selectAll', 'insert', 'insertBulk', 'save', 'del', 'delAll', 'selectGfs', 'selectByPkGfs', 'insertGfs', 'delGfs', 'delAllGfs', 'createStorage', 'close', 'backup', 'recover', 'funTest', 'funTestAndSave']

//已歸類之站點(檔 -> 方法 -> 呼叫次數), 判定見 sgud/rule/rulebook_error-input.md R-ORM-RESULT-01 之站點表
let EXPECT = {
    'genTestData.mjs': { funTestAndSave: 1, funTest: 1, save: 1 },
    'getDb.mjs': { backup: 1, recover: 1 },
    'getDbBackupAndRecover.mjs': { select: 1, createStorage: 1, insert: 1 },
    'getMapOrm.mjs': { select: 2, insert: 2, save: 3, del: 2, delAll: 1 },
    'WServOrm.mjs': { close: 1 },
}

function stripComment(line) {
    let t = line.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
        return ''
    }
    return line.replace(/\s\/\/.*$/, '')
}

function scan(re) {
    let fd = path.resolve('./src')
    let out = {}
    for (let f of fs.readdirSync(fd).filter((v) => v.endsWith('.mjs')).sort()) {
        let txt = fs.readFileSync(path.join(fd, f), 'utf8').split(/\r?\n/).map(stripComment).join('\n')
        for (let m of txt.matchAll(re)) {
            out[f] = out[f] || {}
            out[f][m[1]] = (out[f][m[1]] || 0) + 1
        }
    }
    return out
}


describe('ORM呼叫站點盤點', function() {

    it('O01 src內呼叫ORM實例方法之站點全集同已歸類之表(未歸類為0)', function() {
        //R-ORM-RESULT-01: 新增或移除呼叫須同步更新帳本與此表
        let got = scan(new RegExp(`\\.(${METHODS.join('|')})\\(`, 'g'))
        assert.strict.deepEqual(got, EXPECT)
    })

    it('O02 不得以括號記法或動態方法名呼叫ORM(盤點正則無從涵蓋)', function() {
        //R-ORM-RESULT-01: 以[方法名字串]呼叫者改寫為直接呼叫, 否則O01之盤點不完整
        let got = scan(new RegExp(`\\[['"\`](${METHODS.join('|')})['"\`]\\]`, 'g'))
        assert.strict.deepEqual(got, {})
    })

    it('O03 ORM建構僅getWoItems一處', function() {
        //R-ORM-RESULT-01: 建構失敗以拋錯表達, 無回傳可檢查(不適用)
        let got = scan(/(new) WOrm\(/g)
        assert.strict.deepEqual(got, { 'getWoItems.mjs': { new: 1 } })
    })

})
