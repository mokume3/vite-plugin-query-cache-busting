import './style.css'
import logoUrl from './logo.svg'
import { shared } from './shared'

const app = document.querySelector('#app')
if (app !== null) {
  app.innerHTML = `<img src="${logoUrl}" alt="${shared}" />`
}

document.addEventListener('click', () => {
  void import('./lazy')
})
