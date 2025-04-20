// src/components/Banner.tsx
import React from 'react';

const Banner: React.FC = () => {
    return (
        <div className="bg-white shadow-md p-4">
            <div className="container mx-auto flex justify-between items-center">
                <div className="flex-1 pr-2">
                    <h1 className="text-lg md:text-sm font-bold text-gray-400">
                        Efficient and Robust Multidimensional Attention in Remote Physiological Sensing through Target Signal Constrained Factorization
                    </h1>
                </div>
            </div>
        </div>
    );
};

export default Banner;