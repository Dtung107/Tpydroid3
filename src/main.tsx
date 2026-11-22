import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<
  {children: React.ReactNode},
  ErrorBoundaryState
> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = {hasError: false, message: ''};
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Lỗi khởi chạy giao diện ứng dụng.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-screen bg-[#13131c] text-gray-100 flex items-center justify-center p-5">
          <div className="w-full max-w-md bg-[#1c1c29] border border-rose-500/40 rounded-2xl p-5 space-y-3 shadow-2xl">
            <div className="text-sm font-bold text-rose-300">
              Không thể hiển thị giao diện Pydroid 3
            </div>
            <p className="text-xs text-gray-300 break-words leading-relaxed">
              {this.state.message}
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 py-2 px-3 rounded-xl bg-amber-400 text-black font-bold text-xs cursor-pointer"
              >
                Tải lại ứng dụng
              </button>
              <button
                onClick={() => {
                  try {
                    localStorage.clear();
                  } catch (_) {}
                  window.location.reload();
                }}
                className="py-2 px-3 rounded-xl bg-[#2a293c] text-gray-200 font-semibold text-xs border border-[#3e3c59] cursor-pointer"
              >
                Đặt lại dữ liệu
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
