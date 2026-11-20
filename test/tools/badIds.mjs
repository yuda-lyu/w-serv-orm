//badIds.mjs: 第568項(procOrm對「主鍵給了而無效」者整批拒絕)之共用語料, 供 unit-badid、api-badid 使用; 同一份只定義一次

//類別實例(含自有欄位)
class Foo {
    constructor() {
        this.a = 1
    }
}

//給了而無效之主鍵值(型別全集; 含可經JSON送達者 true、false、{}、[]、{a:1}、[1]); 每項為[標籤, 產生函數], 每次呼叫產生新值
const BAD = [
    ['true', () => true],
    ['false', () => false],
    ['{}', () => ({})],
    ['{a:1}', () => ({ a: 1 })],
    ['[]', () => []],
    ['[1]', () => [1]],
    ['NaN', () => NaN],
    ['Infinity', () => Infinity],
    ['-Infinity', () => -Infinity],
    ['BigInt', () => 10n],
    ['Symbol', () => Symbol('s')],
    ['Date', () => new Date(0)],
    ['Invalid Date', () => new Date(NaN)],
    ['function', () => function() {}],
    ['arrow function', () => () => 'x'],
    ['new String', () => new String('a')], // eslint-disable-line no-new-wrappers
    ['new Number', () => new Number(5)], // eslint-disable-line no-new-wrappers
    ['new Boolean', () => new Boolean(true)], // eslint-disable-line no-new-wrappers
    ['Object(Symbol)', () => Object(Symbol('b'))],
    ['Object(BigInt)', () => Object(11n)],
    ['RegExp', () => /x/],
    ['Map', () => new Map()],
    ['Object.create(null)', () => Object.create(null)],
    ['Proxy', () => new Proxy({}, {})],
    ['class instance', () => new Foo()],
]

//四個收主鍵並補主鍵之寫入入口: msg為其整批拒絕訊息之起首(同 `not an object`、`id contains HTML markup`)
const ENTRIES = [
    { name: 'insert', msg: 'failed to insert data', run: (so, rows) => so.procOrm('u1', 'tests', 'insert', rows) },
    { name: 'save', msg: 'failed to save data', run: (so, rows) => so.procOrm('u1', 'tests', 'save', rows) },
    { name: 'mix.add', msg: 'failed to insert data', run: (so, rows) => so.procOrm('u1', 'tests', 'mix', { add: rows, del: [], diff: [] }) },
    { name: 'mix.diff', msg: 'failed to update data', run: (so, rows) => so.procOrm('u1', 'tests', 'mix', { add: [], del: [], diff: rows }) },
]

export { BAD, ENTRIES }
