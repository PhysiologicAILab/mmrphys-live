import React from 'react';

interface ExampleProps {
    title: string;
}

export const Example: React.FC<ExampleProps> = ({ title }) => {
    return (
        <div>{title}</div>
    );
};