/**
 * 简易计算器 — 纯前端四则运算
 * 无需任何宿主权限，开箱即用
 */

// ===== 计算器状态 =====
const state = {
  currentValue: '0',       // 当前显示的数字（字符串）
  previousValue: null,     // 前一个操作数
  operation: null,         // 当前运算符
  shouldReset: false,      // 下次数字输入是否重置
  expression: '',          // 表达式显示文本
  justCalculated: false    // 刚按了等号
}

// ===== DOM 引用 =====
const displayEl = document.getElementById('display')
const expressionEl = document.getElementById('expression')
const buttonsEl = document.getElementById('buttons')

// ===== 工具函数 =====

/** 格式化数字：加千位分隔符，保留小数 */
function formatNumber(str) {
  if (str === 'Infinity' || str === '-Infinity' || str === 'NaN') return str
  const parts = str.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

/** 根据长度调整字号 */
function adjustFontSize(str) {
  displayEl.classList.remove('small', 'xsmall')
  const len = str.replace(/,/g, '').length
  if (len > 12) displayEl.classList.add('xsmall')
  else if (len > 8) displayEl.classList.add('small')
}

/** 更新显示屏 */
function updateDisplay() {
  const formatted = formatNumber(state.currentValue)
  displayEl.textContent = formatted
  adjustFontSize(formatted)

  // 更新表达式
  let expr = ''
  if (state.previousValue !== null && state.operation) {
    expr = formatNumber(state.previousValue) + ' ' + getOpSymbol(state.operation)
    if (!state.shouldReset) {
      expr += ' ' + formatNumber(state.currentValue)
    }
  }
  expressionEl.textContent = expr
}

/** 运算符符号映射 */
function getOpSymbol(op) {
  const map = { add: '+', subtract: '−', multiply: '×', divide: '÷', percent: '%' }
  return map[op] || op
}

/** 执行计算 */
function compute(a, op, b) {
  const numA = parseFloat(a)
  const numB = parseFloat(b)
  let result

  switch (op) {
    case 'add':      result = numA + numB; break
    case 'subtract': result = numA - numB; break
    case 'multiply': result = numA * numB; break
    case 'divide':
      if (numB === 0) return '不能除以零'
      result = numA / numB
      break
    default: return numB
  }

  // 处理浮点精度
  if (Number.isFinite(result)) {
    // 保留合理精度
    const str = result.toPrecision(12)
    return parseFloat(str).toString()
  }
  return result.toString()
}

// ===== 操作函数 =====

/** 输入数字 */
function inputDigit(digit) {
  if (state.justCalculated) {
    // 刚算完结果，按数字重新开始
    clearAll()
  }
  if (state.shouldReset) {
    state.currentValue = digit
    state.shouldReset = false
  } else {
    if (state.currentValue === '0' && digit !== '.') {
      state.currentValue = digit
    } else {
      state.currentValue += digit
    }
  }
  state.justCalculated = false
  updateDisplay()
}

/** 输入小数点 */
function inputDecimal() {
  if (state.justCalculated) {
    clearAll()
    state.currentValue = '0.'
    state.justCalculated = false
    updateDisplay()
    return
  }
  if (state.shouldReset) {
    state.currentValue = '0.'
    state.shouldReset = false
    updateDisplay()
    return
  }
  if (!state.currentValue.includes('.')) {
    state.currentValue += '.'
  }
  updateDisplay()
}

/** 处理运算符 */
function handleOperator(op) {
  state.justCalculated = false
  if (op === 'percent') {
    // 百分比：当前值除以 100
    state.currentValue = (parseFloat(state.currentValue) / 100).toString()
    updateDisplay()
    return
  }

  if (state.operation && !state.shouldReset) {
    // 连续运算：先算前一步
    const result = compute(state.previousValue, state.operation, state.currentValue)
    state.currentValue = result
    updateDisplay()
  }

  state.previousValue = state.currentValue
  state.operation = op
  state.shouldReset = true
  updateDisplay()
}

/** 计算结果 */
function calculate() {
  if (state.operation === null || state.previousValue === null) return
  if (state.shouldReset) return  // 防止重复按等号

  const result = compute(state.previousValue, state.operation, state.currentValue)
  state.currentValue = result
  state.operation = null
  state.previousValue = null
  state.shouldReset = true
  state.justCalculated = true
  updateDisplay()
}

/** 全部清零 */
function clearAll() {
  state.currentValue = '0'
  state.previousValue = null
  state.operation = null
  state.shouldReset = false
  state.expression = ''
  state.justCalculated = false
  updateDisplay()
}

/** 退格 */
function backspace() {
  if (state.justCalculated) {
    clearAll()
    return
  }
  if (state.shouldReset) return  // 在等待输入时退格无效
  if (state.currentValue.length <= 1 || (state.currentValue.length === 2 && state.currentValue.startsWith('-'))) {
    state.currentValue = '0'
  } else {
    state.currentValue = state.currentValue.slice(0, -1)
  }
  updateDisplay()
}

/** 正负号切换 */
function negate() {
  if (state.currentValue === '0') return
  if (state.justCalculated) {
    state.justCalculated = false
  }
  state.currentValue = (parseFloat(state.currentValue) * -1).toString()
  updateDisplay()
}

// ===== 事件绑定 =====

// 按钮点击
buttonsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button')
  if (!btn) return

  const value = btn.dataset.value
  const action = btn.dataset.action

  if (value !== undefined) {
    if (value === '.') {
      inputDecimal()
    } else {
      inputDigit(value)
    }
  } else if (action) {
    switch (action) {
      case 'clear':     clearAll(); break
      case 'backspace': backspace(); break
      case 'negate':    negate(); break
      case 'percent':
      case 'add':
      case 'subtract':
      case 'multiply':
      case 'divide':    handleOperator(action); break
      case 'equals':    calculate(); break
    }
  }
})

// 键盘支持
document.addEventListener('keydown', (e) => {
  const key = e.key

  if (key >= '0' && key <= '9') {
    e.preventDefault()
    inputDigit(key)
    return
  }

  switch (key) {
    case '.':       e.preventDefault(); inputDecimal(); break
    case '+':       e.preventDefault(); handleOperator('add'); break
    case '-':       e.preventDefault(); handleOperator('subtract'); break
    case '*':       e.preventDefault(); handleOperator('multiply'); break
    case '/':       e.preventDefault(); handleOperator('divide'); break
    case 'Enter':
    case '=':       e.preventDefault(); calculate(); break
    case 'Backspace': e.preventDefault(); backspace(); break
    case 'Escape':
    case 'c':
    case 'C':       e.preventDefault(); clearAll(); break
    case '%':       e.preventDefault(); handleOperator('percent'); break
  }
})

// ===== 初始化 =====
init()

function init() {
  updateDisplay()
}
