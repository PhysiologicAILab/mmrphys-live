export type ModelConfig = {
    FRAME_NUM: number;
    TASKS: string[];
    FS: number;
    sampling_rate: number;
    input_size: number[];
    output_names: string[];
    model_info: {
        name: string;
        version: string;
        description: string;
    };
    model_path: string;
    signal_parameters: {
        bvp: {
            min_rate: number;
            max_rate: number;
            buffer_size: number;
        };
        resp: {
            min_rate: number;
            max_rate: number;
            buffer_size: number;
        };
    };
};

class ConfigService {
    private static instance: ConfigService;
    private config: ModelConfig | null = null;
    private configPromise: Promise<ModelConfig> | null = null;

    private constructor() {}

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    public async getConfig(): Promise<ModelConfig> {
        if (this.config) {
            return this.config!;
        }

        if (!this.configPromise) {
            this.configPromise = this.loadConfig();
        }
        
        return this.configPromise;
    }

    private async loadConfig(): Promise<ModelConfig> {
        try {
            const response = await fetch('/models/rphys/config.json');
            if (!response.ok) {
                throw new Error(`Failed to load config: ${response.status} ${response.statusText}`);
            }
            
            this.config = await response.json();
            console.log('Model configuration loaded:', this.config);
            if (!this.config) {
                throw new Error('Config is null');
            }
            return this.config;
        } catch (error) {
            console.error('Error loading config:', error);
            throw error;
        }
    }
    
    // Utility functions for accessing common config properties
    public async getModelPath(): Promise<string> {
        const config = await this.getConfig();
        return config.model_path;
    }
    
    public async getFrameWidth(): Promise<number> {
        const config = await this.getConfig();
        return config.input_size[4]; // Width is the last dimension in [B,C,T,H,W]
    }
    
    public async getFrameHeight(): Promise<number> {
        const config = await this.getConfig();
        return config.input_size[3]; // Height is the 2nd last dimension
    }
    
    public async getSequenceLength(): Promise<number> {
        const config = await this.getConfig();
        return config.FRAME_NUM;
    }
}

export const configService = ConfigService.getInstance();
export default configService;