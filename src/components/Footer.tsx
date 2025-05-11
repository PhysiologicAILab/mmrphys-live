import React from 'react';

const Footer: React.FC = () => {
    return (
        <footer className="bg-gray-100 py-6 mt-8">
            <div className="container mx-auto px-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h3 className="font-semibold mb-2">Data Privacy Note:</h3>
                        <p className="text-sm text-gray-600">
                            Videos are processed entirely on your device and are never uploaded to any server. The loaded videos as well as the captured video frames are immediately discarded after processing.
                        </p>
                    </div>
                    <div>
                        <h3 className="font-semibold mb-2">Citations:</h3>
                        <p className="text-sm text-gray-600">
                            If you utilize the MMRPhys model or this web application in your research, please cite the following papers: <br />
                        </p>
                        <p className="text-sm text-gray-600">
                            [1] Jitesh Joshi and Youngjun Cho, "Efficient and Robust Multidimensional Attention in Remote Physiological Sensing through Target Signal Constrained Factorization", arXiv:submit/6429247 [cs.CV] 11 May 2025.<br/>
                        </p>
                        <p className="text-sm text-gray-600">
                            [2] Jitesh Joshi, Youngjun Cho, and Sos Agaian, “FactorizePhys: Effective Spatial-Temporal Attention in Remote Photo-plethysmography through Factorization of Voxel Embeddings”, NeurIPS, 2024.<br />
                        </p>
                        <p className="text-sm text-gray-600">
                            [3] Jitesh Joshi and Youngjun Cho, “iBVP Dataset: RGB-thermal rPPG Dataset with High Resolution Signal Quality Labels”, MDPI Electronics, 13(7), 2024.<br />
                        </p>
                    </div>
                    <div>
                        <h3 className="font-semibold mb-2">Source Code:</h3>
                        <p className="text-sm text-gray-600">
                            Source code for MMRPhys: <a href="https://github.com/PhysiologicAILab/MMRPhys" target="_blank" rel="noopener noreferrer">https://github.com/PhysiologicAILab/MMRPhys</a>.
                        </p>
                        <p className="text-sm text-gray-600">
                            Source code for this webapp: <a href="https://github.com/physiologicailab/mmrphys-live" target="_blank" rel="noopener noreferrer">https://github.com/physiologicailab/mmrphys-live</a>.
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