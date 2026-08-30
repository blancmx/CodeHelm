import type { AnalysisTaskDto } from '@codehelm/contracts';

export function getAnalysisPresentation(status?: AnalysisTaskDto['status']) {
  switch (status) {
    case 'completed': return { label: '分析完成', tone: 'success' } as const;
    case 'failed': return { label: '分析失败', tone: 'error' } as const;
    case 'cancelled': return { label: '已取消', tone: 'warning' } as const;
    case 'cancelling': return { label: '正在停止', tone: 'warning' } as const;
    case 'saving': return { label: '正在保存', tone: 'default' } as const;
    case 'running': return { label: '扫描分析中', tone: 'default' } as const;
    default: return { label: '等待分析', tone: 'default' } as const;
  }
}
