import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const chartConfig: ChartConfig = {
  approved: {
    label: 'Aprovadas',
    color: 'hsl(142.1 76.2% 36.3%)',
  },
  rejected: {
    label: 'Rejeitadas',
    color: 'hsl(0 84.2% 60.2%)',
  },
}

type TimeRange = '7d' | '30d' | '90d'

interface CalibrationTrendItem {
  date: string
  approved: number
  rejected: number
}

interface ChartCalibrationsProps {
  data: CalibrationTrendItem[]
  isLoading?: boolean
}

function filterDataByTimeRange(
  data: CalibrationTrendItem[],
  timeRange: TimeRange,
): CalibrationTrendItem[] {
  if (!data.length) return data

  const now = new Date()
  let daysToSubtract = 90

  if (timeRange === '30d') {
    daysToSubtract = 30
  } else if (timeRange === '7d') {
    daysToSubtract = 7
  }

  const startDate = new Date(now)
  startDate.setDate(startDate.getDate() - daysToSubtract)

  return data.filter((item) => {
    const itemDate = new Date(item.date)
    return itemDate >= startDate
  })
}

export function ChartCalibrations({ data, isLoading }: ChartCalibrationsProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')

  const filteredData = useMemo(
    () => filterDataByTimeRange(data, timeRange),
    [data, timeRange],
  )

  if (isLoading) {
    return (
      <Card className="rounded-2xl">
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-1 h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="@container/chart rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05),0_16px_40px_rgba(0,0,0,0.05)]">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-balance">
            Resultado das calibrações
          </CardTitle>
          <CardDescription>
            Aprovações e rejeições para acompanhar estabilidade do processo.
          </CardDescription>
        </div>
        <div className="hidden gap-1 rounded-xl bg-muted/60 p-1 @[440px]/chart:flex">
          {(['7d', '30d', '90d'] as const).map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setTimeRange(range)}
              className="min-h-10 active:scale-[0.96] transition-transform"
            >
              {range === '7d'
                ? '7 dias'
                : range === '30d'
                  ? '30 dias'
                  : '90 dias'}
            </Button>
          ))}
        </div>
        <div className="@[440px]/chart:hidden">
          <Select
            value={timeRange}
            onValueChange={(v) => setTimeRange(v as TimeRange)}
          >
            <SelectTrigger size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">7 dias</SelectItem>
              <SelectItem value="30d">30 dias</SelectItem>
              <SelectItem value="90d">90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {filteredData.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-muted-foreground">
            Nenhum dado disponível para o período selecionado
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[250px] w-full">
            <AreaChart
              data={filteredData}
              margin={{ left: 0, right: 0, top: 10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="fillApproved" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-approved)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-approved)"
                    stopOpacity={0}
                  />
                </linearGradient>
                <linearGradient id="fillRejected" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-rejected)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-rejected)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                className="stroke-muted"
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value)
                  return date.toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                  })
                }}
                className="text-xs text-muted-foreground"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={30}
                className="text-xs text-muted-foreground"
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      return new Date(value).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })
                    }}
                    indicator="dot"
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="approved"
                stroke="var(--color-approved)"
                fill="url(#fillApproved)"
                strokeWidth={2}
                activeDot={{ r: 4 }}
              />
              <Area
                type="monotone"
                dataKey="rejected"
                stroke="var(--color-rejected)"
                fill="url(#fillRejected)"
                strokeWidth={2}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
