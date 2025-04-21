// src/components/Banner.tsx
import React from 'react';

const Banner: React.FC = () => {
    return (
        <div className="bg-white shadow-md p-4" style={{ textAlign: 'center' }}>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                <div style={{ maxWidth: '600px', textAlign: 'center', margin: '0 auto' }}>
                    <h3 className="text-lg font-bold text-gray-400" style={{ textAlign: 'center' }}>
                        Camera-based Remote Physiological Sensing
                    </h3>
                </div>
            </div>
        </div>
    );
};

export default Banner;