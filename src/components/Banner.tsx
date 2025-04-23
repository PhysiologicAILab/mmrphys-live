// src/components/Banner.tsx
import React from 'react';

const Banner: React.FC = () => {
    return (
        <div className="bg-white shadow-md p-4" style={{ textAlign: 'center' }}>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                <div style={{ maxWidth: '600px', textAlign: 'center', margin: '0 auto' }}>
                    <h1 className="text-lg text-gray-400" style={{ textAlign: 'center' }}>
                        Remote Physiological Sensing using Webcam/ Recorded Video
                    </h1>
                </div>
            </div>
        </div>
    );
};

export default Banner;