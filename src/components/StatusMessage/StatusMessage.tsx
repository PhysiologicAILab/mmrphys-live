import React from 'react';
import { StatusMessageProps } from '@/types';

const StatusMessage: React.FC<StatusMessageProps> = ({ message, type }) => {
    return (
        <div className={`status-message ${type}`}>
            {message}
        </div>
    );
};

export default StatusMessage;