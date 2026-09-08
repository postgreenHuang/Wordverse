import type { Graph } from './types'

export const initialGraph: Graph = {
  id: 'root', name: '主词网',
  nodes: [
    { id: 'memory', label: '记忆', note: '不是保存全部，而是保存可再次展开的触发点。', tags: ['认知', '学习'], links: [], position: [0, .4, 0], scale: 1, hasChildGraph: true },
    { id: 'connection', label: '联系', note: '知识的意义常常存在于词与词之间。', tags: ['结构'], links: [], position: [-3.1, 1.6, -2.1], scale: 1 },
    { id: 'insight', label: '领悟', note: '学习瞬间形成的个人理解。', tags: ['灵感'], links: [], position: [3.2, 1.4, -2.7], scale: 1, hasChildGraph: true },
    { id: 'review', label: '温习', note: '让词网缓慢回到眼前。', tags: ['习惯'], links: [], position: [-2.3, -1.7, 1.8], scale: 1 },
    { id: 'context', label: '语境', note: '词眼展开之后的上下文。', tags: ['理解'], links: [], position: [2.7, -1.5, 2.4], scale: 1 },
    { id: 'question', label: '问题', note: '继续向深处探索的入口。', tags: ['探索'], links: [], position: [.4, 2.9, -3.4], scale: 1 }
  ],
  edges: [
    { source: 'memory', target: 'connection' }, { source: 'memory', target: 'insight' },
    { source: 'memory', target: 'review' }, { source: 'insight', target: 'context' },
    { source: 'insight', target: 'question' }, { source: 'connection', target: 'context' }
  ]
}
