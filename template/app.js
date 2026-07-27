/* 蛋的全部逻辑写在这里（ES Module），通过全局对象 egg.* 使用宿主能力 */

async function init() {
  const app = document.getElementById('app')
  app.innerHTML = `
    <div class="empty-state">
      <svg class="icon xl"><use href="icons.svg#egg"></use></svg>
      <p>这颗蛋还没有内容</p>
    </div>
  `
}

init()
