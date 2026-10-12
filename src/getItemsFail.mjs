import getItemsFail from 'w-data-collector/src/getItemsFail.mjs'


//相容檔: 本套件1.1.7曾以此路徑提供getItemsFail, 使用端有以深層路徑引用者(如w-web-sso之server/ormWrite.mjs), 故保留並轉出w-data-collector之實作
export default getItemsFail
