/* 1. Configuration: 외부 설정 및 글로벌 스타일 호출*/
import type { Metadata } from "next";
import "./globals.css"; // 프로젝트 전체에 적용될 Tailwind 및 기본 CSS

/* 2. SEO & Meta: 검색 엔진 및 공유(OG) 시 노출될 서비스 정보 */
export const metadata: Metadata = {
  title: "엘 영어학원 출석 시스템",
  description: "엘 영어학원의 등/하원을 보조하는 서비스 입니다",
};

/* 3. Global Layout: 모든 페이지를 감싸는 최상위 뼈대 */
// 이 레이아웃이 받는 입력값의 규격 선언
type RootLayoutProps = {
  // 각 페이지(page.tsx)의 내용이 이 변수에 담겨서 들어옴
  children: React.ReactNode; // 텍스트·HTML·컴포넌트 등 모든 렌더링 가능한 값을 허용
};

// Readonly: 전달받은 children을 함수 안에서 수정 불가로 잠금 — 외부 페이지 내용 보호
export default function RootLayout({ children }: Readonly<RootLayoutProps>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/* 외부 폰트(Pretendard) 로드: 가독성 좋은 국산 폰트 적용 */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css" />
      </head>
      <body className="min-h-full flex flex-col">
        {/* min-h-full: 내용이 적어도 화면 높이를 꽉 채우도록 설정 */}
        {/* flex-col: 내부 요소(헤더, 본문, 푸터 등)를 세로 방향으로 정렬 */}
        {children} {/* 페이지별 콘텐츠가 이 위치에 렌더링됨 */}
      </body>
    </html>
  );
}
