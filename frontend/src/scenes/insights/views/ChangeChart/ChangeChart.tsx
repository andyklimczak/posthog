import { useValues } from 'kea'
import { MouseEvent, useState } from 'react'

import { dayjs } from 'lib/dayjs'
import { formatAggregationAxisValue } from 'scenes/insights/aggregationAxisFormat'
import { InsightEmptyState } from 'scenes/insights/EmptyStates'
import { insightLogic } from 'scenes/insights/insightLogic'
import { insightVizDataLogic } from 'scenes/insights/insightVizDataLogic'
import { formatBreakdownLabel } from 'scenes/insights/utils'
import { openPersonsModal } from 'scenes/trends/persons-modal/PersonsModal'
import { trendsDataLogic } from 'scenes/trends/trendsDataLogic'

import { cohortsModel } from '~/models/cohortsModel'
import { propertyDefinitionsModel } from '~/models/propertyDefinitionsModel'
import { NodeKind } from '~/queries/schema/schema-general'
import { teamLogic } from '~/scenes/teamLogic'
import { ChartParams, TrendResult } from '~/types'

import {
    buildChangeChartRows,
    ChangeChartRow,
    ChangeChartDisplayMode,
    formatChangeChartPercent,
    getChangeChartBarWidthPercent,
    getChangeChartDisplayValue,
    getChangeChartDomain,
    getChangeChartVizOptions,
    sortChangeChartRows,
} from './utils'

const tickClassName = 'absolute top-0 bottom-0 w-px bg-border'
const gridClassName = 'grid grid-cols-[7rem_minmax(8rem,12rem)_minmax(24rem,1fr)] gap-4 items-center px-3'
const TOOLTIP_WIDTH_PX = 360
const TOOLTIP_HEIGHT_PX = 110
const plotInsetClassName = 'absolute inset-y-0 left-[5rem] right-[5rem]'

function getGridClassName(showCurrentValue: boolean): string {
    return showCurrentValue
        ? gridClassName
        : 'grid grid-cols-[minmax(8rem,12rem)_minmax(24rem,1fr)] gap-4 items-center px-3'
}

const directionClasses = {
    up: {
        bar: 'bg-success-highlight',
        tip: 'bg-success',
        text: 'text-success',
        tooltipPanel: 'bg-success-highlight',
        tooltipValue: 'text-success',
    },
    down: {
        bar: 'bg-danger-highlight',
        tip: 'bg-danger',
        text: 'text-danger',
        tooltipPanel: 'bg-danger-highlight',
        tooltipValue: 'text-danger',
    },
    flat: {
        bar: 'bg-border',
        tip: 'bg-border-bold',
        text: 'text-secondary',
        tooltipPanel: 'bg-fill-secondary',
        tooltipValue: 'text-primary',
    },
    unavailable: {
        bar: 'bg-border',
        tip: 'bg-border-bold',
        text: 'text-secondary',
        tooltipPanel: 'bg-fill-secondary',
        tooltipValue: 'text-primary',
    },
} as const

function ChangeChartTooltip({
    row,
    formatValue,
    metricLabel,
    previousPeriodLabel,
    currentPeriodLabel,
}: {
    row: ChangeChartRow
    formatValue: (value: number) => string
    metricLabel: string
    previousPeriodLabel: string
    currentPeriodLabel: string
}): JSX.Element {
    const directionClass = directionClasses[row.direction]

    return (
        <div className="pointer-events-none flex items-stretch overflow-hidden rounded-md border border-primary bg-surface-primary shadow-lg">
            <div className="min-w-40 border-r border-primary bg-surface-primary px-3 py-2 text-sm">
                <div className="font-semibold text-primary">
                    {row.previousValue === null ? 'No data' : `${formatValue(row.previousValue)} ${metricLabel}`.trim()}
                </div>
                <div className="mt-1 text-xs leading-5 text-secondary">{previousPeriodLabel}</div>
            </div>
            <div className={`min-w-40 px-3 py-2 text-sm ${directionClass.tooltipPanel}`}>
                <div className={`font-semibold ${directionClass.tooltipValue}`}>
                    {`${formatValue(row.currentValue)} ${metricLabel}`.trim()}
                </div>
                <div className="mt-1 text-xs leading-5 text-secondary">{currentPeriodLabel}</div>
            </div>
        </div>
    )
}

function formatChangeChartPeriodLabel(dateFrom: string, dateTo: string): string {
    const start = dayjs(dateFrom)
    const end = dayjs(dateTo)

    if (!start.isValid() || !end.isValid()) {
        return 'Current period'
    }

    if (start.isSame(end, 'day')) {
        return `${start.format('MMM D, h:mm A')} - ${end.format('h:mm A')}`
    }

    return `${start.format('MMM D, h:mm A')} - ${end.format('MMM D, h:mm A')}`
}

export function ChangeChartView({
    rows,
    domain,
    formatValue,
    formatChangeValue,
    formatAxisLabel,
    getLabel,
    onRowClick,
    scrollClassName,
    getMetricLabel,
    previousPeriodLabel,
    currentPeriodLabel,
    displayMode,
    showCurrentValue,
}: {
    rows: ChangeChartRow[]
    domain: number
    formatValue: (value: number) => string
    formatChangeValue: (row: ChangeChartRow) => string
    formatAxisLabel: (value: number, displayMode: ChangeChartDisplayMode) => string
    getLabel: (row: ChangeChartRow) => string
    getMetricLabel: (row: ChangeChartRow) => string
    previousPeriodLabel: string
    currentPeriodLabel: string
    displayMode: ChangeChartDisplayMode
    showCurrentValue: boolean
    onRowClick?: (row: ChangeChartRow) => void
    scrollClassName?: string
}): JSX.Element {
    const [hoveredTooltip, setHoveredTooltip] = useState<{
        row: ChangeChartRow
        metricLabel: string
        x: number
        y: number
    } | null>(null)

    const setTooltipPosition = (event: MouseEvent, row: ChangeChartRow, metricLabel: string): void => {
        const x = Math.min(event.clientX + 16, window.innerWidth - TOOLTIP_WIDTH_PX - 12)
        const y = Math.min(event.clientY + 16, window.innerHeight - TOOLTIP_HEIGHT_PX - 12)
        setHoveredTooltip({ row, metricLabel, x: Math.max(12, x), y: Math.max(12, y) })
    }

    return (
        <div
            className={`w-full overflow-x-auto ${scrollClassName ?? 'max-h-[32rem] overflow-y-auto'}`}
            data-attr="change-chart"
        >
            <div className="w-full min-w-[54rem]">
                <div className="sticky top-0 z-10 bg-surface-primary pb-2">
                    <div className={`${getGridClassName(showCurrentValue)} pt-3 text-xs text-tertiary`}>
                        {showCurrentValue ? <div>Current</div> : null}
                        <div>Breakdown</div>
                        <div className="relative h-8">
                            <div className={plotInsetClassName}>
                                <div className={`left-0 ${tickClassName}`} />
                                <div className={`left-1/4 ${tickClassName}`} />
                                <div className={`left-1/2 ${tickClassName}`} />
                                <div className={`left-3/4 ${tickClassName}`} />
                                <div className={`right-0 ${tickClassName}`} />
                                <div className="absolute inset-x-0 top-0 flex justify-between">
                                    <span>{formatAxisLabel(-domain, displayMode)}</span>
                                    <span>{formatAxisLabel(-(domain / 2), displayMode)}</span>
                                    <span>{formatAxisLabel(0, displayMode)}</span>
                                    <span>{formatAxisLabel(domain / 2, displayMode)}</span>
                                    <span>{formatAxisLabel(domain, displayMode)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div>
                    {rows.map((row) => {
                        const width = getChangeChartBarWidthPercent(row, domain, displayMode)
                        const directionClass = directionClasses[row.direction]
                        const percentLabel =
                            displayMode === 'absolute'
                                ? formatChangeValue(row)
                                : formatChangeChartPercent(row.percentChange)
                        const label = getLabel(row)
                        const metricLabel = getMetricLabel(row)
                        const clickable = !!onRowClick
                        const isPositive = row.direction === 'up'
                        const labelStyle =
                            row.direction === 'unavailable'
                                ? { left: 'calc(50% + 0.5rem)' }
                                : isPositive
                                  ? { left: `calc(50% + ${width}% + 0.35rem)` }
                                  : { right: `calc(50% + ${width}% + 0.35rem)` }

                        return (
                            <div
                                key={JSON.stringify(row.breakdownValue ?? label)}
                                className={`${getGridClassName(showCurrentValue)} border-t border-primary py-2 first:border-t-0 ${clickable ? 'cursor-pointer hover:bg-fill-secondary' : ''}`}
                                onClick={clickable ? () => onRowClick(row) : undefined}
                                onMouseEnter={(event) => setTooltipPosition(event, row, metricLabel)}
                                onMouseMove={(event) => setTooltipPosition(event, row, metricLabel)}
                                onMouseLeave={() =>
                                    setHoveredTooltip((current) => (current?.row === row ? null : current))
                                }
                            >
                                {showCurrentValue ? (
                                    <div className="font-semibold truncate">{formatValue(row.currentValue)}</div>
                                ) : null}
                                <div className="truncate">{label}</div>
                                <div className="relative h-8">
                                    <div className={plotInsetClassName}>
                                        <div className={`left-0 ${tickClassName}`} />
                                        <div className={`left-1/4 ${tickClassName}`} />
                                        <div className={`left-1/2 ${tickClassName}`} />
                                        <div className={`left-3/4 ${tickClassName}`} />
                                        <div className={`right-0 ${tickClassName}`} />
                                        {width > 0 && (
                                            <div
                                                className={`absolute top-1/2 -translate-y-1/2 h-3 rounded-sm ${directionClass.bar}`}
                                                style={
                                                    isPositive
                                                        ? { left: '50%', width: `${width}%` }
                                                        : { left: `calc(50% - ${width}%)`, width: `${width}%` }
                                                }
                                            >
                                                <div
                                                    className={`absolute top-0 h-full w-3 ${directionClass.tip}`}
                                                    style={{
                                                        [isPositive ? 'right' : 'left']: 0,
                                                        clipPath: isPositive
                                                            ? 'polygon(0 0, 100% 50%, 0 100%)'
                                                            : 'polygon(100% 0, 0 50%, 100% 100%)',
                                                    }}
                                                />
                                            </div>
                                        )}
                                        <div
                                            className={`absolute top-1/2 -translate-y-1/2 text-xs font-medium whitespace-nowrap ${directionClass.text}`}
                                            style={labelStyle}
                                        >
                                            {percentLabel}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
                {hoveredTooltip && (
                    <div className="fixed z-[1000]" style={{ left: hoveredTooltip.x, top: hoveredTooltip.y }}>
                        <ChangeChartTooltip
                            row={hoveredTooltip.row}
                            formatValue={formatValue}
                            metricLabel={hoveredTooltip.metricLabel}
                            previousPeriodLabel={previousPeriodLabel}
                            currentPeriodLabel={currentPeriodLabel}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}

export function ChangeChart({ showPersonsModal = true, context, inCardView }: ChartParams): JSX.Element {
    const { insightProps } = useValues(insightLogic)
    const { insightData, vizSpecificOptions } = useValues(insightVizDataLogic(insightProps))
    const { indexedResults, trendsFilter, breakdownFilter, querySource, hasDataWarehouseSeries } = useValues(
        trendsDataLogic(insightProps)
    )
    const { allCohorts } = useValues(cohortsModel)
    const { formatPropertyValueForDisplay } = useValues(propertyDefinitionsModel)
    const { baseCurrency } = useValues(teamLogic)

    const options = getChangeChartVizOptions(vizSpecificOptions)
    const unsortedRows = buildChangeChartRows(indexedResults)

    if (unsortedRows.length === 0) {
        return <InsightEmptyState />
    }

    const formatValue = (value: number): string => formatAggregationAxisValue(trendsFilter, value, baseCurrency)
    const formatAxisLabel = (value: number, displayMode: ChangeChartDisplayMode): string =>
        displayMode === 'absolute' ? formatValue(value) : `${value}%`
    const getLabel = (row: ChangeChartRow): string =>
        formatBreakdownLabel(row.breakdownValue, breakdownFilter, allCohorts?.results, formatPropertyValueForDisplay)
    const getMetricLabel = (row: ChangeChartRow): string => row.current?.label ?? row.previous?.label ?? ''
    const rows = sortChangeChartRows(unsortedRows, options, getLabel)
    const domain = getChangeChartDomain(rows, options.displayMode)
    const formatChangeValue = (row: ChangeChartRow): string => {
        const value = getChangeChartDisplayValue(row, options.displayMode)
        if (value === null) {
            return 'No previous data'
        }
        if (!Number.isFinite(value)) {
            return value > 0 ? '+inf' : '-inf'
        }
        const sign = value > 0 ? '+' : value < 0 ? '-' : ''
        return `${sign}${formatValue(Math.abs(value))}`
    }

    const currentPeriodLabel =
        insightData?.resolved_date_range?.date_from && insightData?.resolved_date_range?.date_to
            ? formatChangeChartPeriodLabel(
                  insightData.resolved_date_range.date_from,
                  insightData.resolved_date_range.date_to
              )
            : 'Current period'
    const previousPeriodLabel =
        insightData?.resolved_date_range?.date_from && insightData?.resolved_date_range?.date_to
            ? (() => {
                  const currentStart = dayjs(insightData.resolved_date_range.date_from)
                  const currentEnd = dayjs(insightData.resolved_date_range.date_to)
                  const durationMs = currentEnd.diff(currentStart)

                  return formatChangeChartPeriodLabel(
                      currentStart.subtract(durationMs, 'millisecond').toISOString(),
                      currentEnd.subtract(durationMs, 'millisecond').toISOString()
                  )
              })()
            : 'Previous period'

    const onRowClick =
        context?.onDataPointClick || (showPersonsModal && querySource && !hasDataWarehouseSeries)
            ? (row: ChangeChartRow) => {
                  const referenceRow = (row.current ?? row.previous) as TrendResult | null
                  if (!referenceRow) {
                      return
                  }

                  if (context?.onDataPointClick) {
                      context.onDataPointClick({ breakdown: row.breakdownValue, compare: 'current' }, referenceRow)
                      return
                  }

                  openPersonsModal({
                      title: getLabel(row),
                      query: {
                          kind: NodeKind.InsightActorsQuery,
                          source: querySource,
                          includeRecordings: true,
                          series: referenceRow.action?.order ?? 0,
                          breakdown: row.breakdownValue,
                          compare: 'current',
                      },
                      additionalSelect: {
                          value_at_data_point: 'event_count',
                          matched_recordings: 'matched_recordings',
                      },
                      orderBy: ['event_count DESC, actor_id DESC'],
                  })
              }
            : undefined

    return (
        <ChangeChartView
            rows={rows}
            domain={domain}
            formatValue={formatValue}
            formatChangeValue={formatChangeValue}
            formatAxisLabel={formatAxisLabel}
            getLabel={getLabel}
            getMetricLabel={getMetricLabel}
            previousPeriodLabel={previousPeriodLabel}
            currentPeriodLabel={currentPeriodLabel}
            displayMode={options.displayMode}
            showCurrentValue={options.showCurrentValue}
            onRowClick={onRowClick}
            scrollClassName={inCardView ? 'max-h-80 overflow-y-auto' : 'max-h-[32rem] overflow-y-auto'}
        />
    )
}
