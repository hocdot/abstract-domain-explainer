import katex from 'katex'
import { useMemo } from 'react'

const OPTIONS: katex.KatexOptions = {
  throwOnError: false,
  // \htmlClass lets formulas reuse the theme's lower/upper colors
  trust: (ctx) => ctx.command === '\\htmlClass',
  strict: 'ignore',
}

export const lo = (tex: string) => `\\htmlClass{tex-lo}{${tex}}`
export const hi = (tex: string) => `\\htmlClass{tex-hi}{${tex}}`

export function Tex({ children, block = false }: { children: string; block?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(children, { ...OPTIONS, displayMode: block }),
    [children, block],
  )
  return <span className={block ? 'tex-block' : 'tex'} dangerouslySetInnerHTML={{ __html: html }} />
}
