import React, { useMemo } from 'react';
import VitalSignsChart from '../VitalSignsChart';

const VitalSignsChartWrapper: React.FC<{
    title: string;
    data: number[];
    rate: number;
    type: 'bvp' | 'resp';
    isReady: boolean;
}> = React.memo(({ title, data, rate, type, isReady }) => {
    console.log(`Rendering ${type} chart:`, {
        dataLength: data.length,
        rate,
        isReady
    });

    const shouldRender = isReady && data.length > 0;

    return (
        <VitalSignsChart
            title={title}
            data={data}
            rate={rate}
            type={type}
            isReady={shouldRender}
        />
    );
});

export default VitalSignsChartWrapper;