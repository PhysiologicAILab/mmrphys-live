// src/components/Banner.tsx
import React from 'react';

const Banner: React.FC = () => {
    return (
        <div className="bg-white shadow-md p-4">
            <div className="container mx-auto flex justify-between items-center">
                <div className="flex-1 pr-2">
                    <h3 className="text-lg md:text-sm font-bold text-gray-400">
                        Camera-based Remote Physiological Sensing
                    </h3>
                    Note: The captured video will not be uploaded to cloud.
                </div>
            </div>
        </div>
    );
};

export default Banner;