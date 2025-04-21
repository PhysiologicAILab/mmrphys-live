import React from 'react';

const Footer: React.FC = () => {
    return (
        <footer className="bg-gray-100 py-6 mt-8">
            <div className="container mx-auto px-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h3 className="font-semibold mb-2">Citation:</h3>
                        <p className="text-sm text-gray-600">
                            Jitesh Joshi and Youngjun Cho, "Efficient and Robust Multidimensional Attention in Remote Physiological Sensing through Target Signal Constrained Factorization", In Review, 2025<br />
                            
                        </p>
                    </div>
                    {/* <div>
                        <h3 className="font-semibold mb-2">Copyright:</h3>
                        <p className="text-sm text-gray-600">
                            Copyright (c) 2025 Computational Physiology and Intelligence Research at Department of Computer Science, University College London, 169 Euston Road, London, NW1 2AE, England, United Kingdom.
                        </p>
                    </div> */}
                </div>
            </div>
        </footer>
    );
};

export default Footer; 