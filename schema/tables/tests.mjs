import map from 'lodash-es/map.js'
import keys from 'lodash-es/keys.js'
import genID from 'wsemi/src/genID.mjs'
import dtmapping from 'wsemi/src/dtmapping.mjs'
import dtpick from 'wsemi/src/dtpick.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'
import isestr from 'wsemi/src/isestr.mjs'


let keyTable = 'tests'
let tableNameCht = 'Tests'
let tableNameEng = 'Tests'

let settings = {
    'id': {
        pk: true,
        name: '主鍵',
        type: 'STRING',
    },
    'timeCreate': {
        name: '創建時間',
        type: 'STRING',
    },
    'timeUpdate': {
        name: '更新時間',
        type: 'STRING',
    },
    'isActive': {
        name: '是否有效',
        type: 'STRING',
    },
}

let funNew = (ndata = {}) => {
    let o = dtmapping(ndata, keys(settings))
    o.id = `${now2strp()}-${genID()}`
    o.timeCreate = nowms2str()
    o.timeUpdate = o.timeCreate
    o.isActive = 'y'
    return o
}

let funTest = () => {
    let rs = map([
        {
            'id': 'id-for-tests-1',
        },
        {
            'id': 'id-for-tests-2',
        },
        {
            'id': 'id-for-tests-3',
        },
    ], (item, k) => {
        let v = funNew({ ...item, order: k })
        v.id = item.id
        if (isestr(item.timeUpdate)) {
            v.timeUpdate = item.timeUpdate
        }
        v = dtpick(v, keys(settings))
        return v
    })
    console.log(`已產生: {keyTable} 測試資料`, rs)
    return rs
}

let tab = {
    keyTable,
    tableNameCht,
    tableNameEng,
    settings,
    funNew,
    funTest,
}


export default tab
