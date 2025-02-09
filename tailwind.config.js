/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: '#2c3e50',
                    light: '#34495e',
                    dark: '#1a252f'
                },
                accent: {
                    DEFAULT: '#3498db',
                    light: '#5faee3',
                    dark: '#2980b9'
                },
                success: {
                    DEFAULT: '#2ecc71',
                    light: '#48d683',
                    dark: '#27ae60'
                },
                warning: {
                    DEFAULT: '#f1c40f',
                    light: '#f4d03f',
                    dark: '#f39c12'
                },
                error: {
                    DEFAULT: '#e74c3c',
                    light: '#eb6b5e',
                    dark: '#c0392b'
                }
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }
        },
    },
    plugins: [],
}