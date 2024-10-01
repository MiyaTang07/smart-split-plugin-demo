import { parse } from "acorn" // 解析器，用于静态分析
import { createFilter } from "vite" // Vite 过滤器
import { simple } from 'acorn-walk' // ast树被存储在一个对象，方便解析
import path from 'node:path'
import fs from 'node:fs'

// 数据文件路径
const dataFilePath = path.join(__dirname, 'moduleUsage.json')

export default function SmartSplitPlugin(options = {}) {
  const filter = createFilter(
    options.include || /\.(js|ts|vue)$/,
    options.exclude || /node_modules/
  )

  return {
    name: "smart-split-plugin",
    transform(code, id) {
      if (!filter(id)) return
      // console.log("filter=====>", filter(id), id, code)
      // 1. 静态分析：解析模块
      const modules = extractModules(code, id)
      // 2. 记录模块使用情况
      const moduleUsage = trackModuleUsage(modules)
      // 3. 生成智能分割建议
      const suggestions = generateSplitSuggestions(moduleUsage)
      // 4. 输出优化建议
      console.log('智能分割建议===:', suggestions)
      return code
    }
  }
}

/*
* 提取模块信息的函数
 * @param {string} code - 要解析的代码
 * @param {string} fileName - 当前模块的文件名
 * @returns {Array} - 模块信息数组
 * */
function extractModules(code, fileName) {
  const ast = parse(code, { 
    ecmaVersion: 'latest', 
    sourceType: 'module',  // 'module || script'
    allowImportExportEverywhere: true
   })
   const modules = []
   let fileSize
   if (fs.existsSync(fileName)) {
      const stats = fs.statSync(fileName)
      fileSize = stats.size; // 文件大小以字节为单位
  }
   // 遍历 AST，提取模块信息
   simple(ast, {
       // 处理导入声明
       ImportDeclaration(node) {
           const moduleName = node.source.value // 获取导入的模块名称
           const imported = node.specifiers.map(specifier => specifier.local.name) // 获取导入的变量
           modules.push({
               type: 'import',
               moduleName,
               imported,
               from: fileName, // 记录当前文件名
               fileSize
           })
       },
       // 处理命名导出声明
       ExportNamedDeclaration(node) {
           const exported = node.specifiers.map(specifier => specifier.exported.name) // 获取导出的变量
           const moduleName = fileName // 当前模块名
           modules.push({
               type: 'export',
               moduleName,
               exported,
               fileSize
           })
       },
       // 处理默认导出声明（可选）
       ExportDefaultDeclaration(node) {
           const moduleName = fileName // 当前模块名
           const exported = node.declaration.name || 'default' // 默认导出的变量名
           modules.push({
               type: 'export-default',
               moduleName,
               exported: [exported],
               fileSize
           })
       }
   })
   return modules
}

/**
 * 追踪模块使用情况的函数
 * @param {Array} modules - 提取的模块信息数组
 */
function trackModuleUsage(modules) {
  let usageData = {}
  // 读取现有数据
  if (fs.existsSync(dataFilePath)) {
    const fileData = fs.readFileSync(dataFilePath)
    usageData = JSON.parse(fileData)
  }

  modules.forEach(module => {
      const { moduleName, imported, fileSize } = module
      // 初始化模块使用数据
      if (!usageData[moduleName]) {
          usageData[moduleName] = { loadCount: 0, imported: [], fileSize }
      }

      // 记录导入的模块
      if (imported && imported.length > 0) {
          usageData[moduleName].imported.push(...imported)
      }

      // 增加加载次数
      usageData[moduleName].loadCount++
  })

  // 保存更新后的数据
  fs.writeFileSync(dataFilePath, JSON.stringify(usageData, null, 2))
}

/**
 * 生成懒加载建议的函数
 * @returns {Array} - 懒加载建议数组
 */
function generateSplitSuggestions() {
  let usageData = {}

  // 读取现有数据
  if (fs.existsSync(dataFilePath)) {
      const fileData = fs.readFileSync(dataFilePath)
      usageData = JSON.parse(fileData)
  }

  const suggestions = []
  const sizeThreshold = 100 * 1024 // 体积阈值（例如：100 KB）
  const loadCountThreshold = 3 // 加载次数阈值

  for (const moduleName in usageData) {
      const { loadCount, fileSize } = usageData[moduleName]

      // 根据文件大小和加载次数生成懒加载建议
      if (fileSize > sizeThreshold || loadCount > loadCountThreshold) {
        suggestions.push({
            moduleName,
            reason: `建议对模块 "${moduleName}" 进行懒加载。` +
                    (fileSize > sizeThreshold ? `该模块体积超过 ${sizeThreshold / 1024} KB。` : '') +
                    (loadCount > loadCountThreshold ? `加载次数超过 ${loadCountThreshold} 次。` : '')
        })
      }
  }
  return suggestions
}
