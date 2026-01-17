// Dashboard types - no schema needed as this aggregates data from other collections

export interface DashboardStats {
  totalCalls: number;
  completedCalls: number;
  missedCalls: number;
  failedCalls: number;
  avgDurationSeconds: number;
  avgDurationFormatted: string;
  successRate: number;
  totalAgents: number;
  activeAgents: number;
  totalCampaigns: number;
  activeCampaigns: number;
}

export interface DashboardTrends {
  calls: TrendData;
  completed: TrendData;
  missed: TrendData;
  duration: TrendData;
  successRate: TrendData;
}

export interface TrendData {
  value: number;
  change: number;
  isUp: boolean;
}

export interface RecentCall {
  id: string;
  caller: string;
  agentName: string;
  duration: string;
  durationSeconds: number;
  time: string;
  status: 'completed' | 'missed' | 'ongoing' | 'failed';
  callType: string;
}

export interface DashboardResponse {
  stats: DashboardStats;
  trends: DashboardTrends;
  recentCalls: RecentCall[];
  period: string;
}

export interface AgentPerformance {
  agentId: string;
  agentName: string;
  totalCalls: number;
  completedCalls: number;
  successRate: number;
  avgDuration: number;
}

export interface CallsByHour {
  hour: number;
  count: number;
}

export interface CallsByDay {
  date: string;
  count: number;
  completed: number;
  missed: number;
}
