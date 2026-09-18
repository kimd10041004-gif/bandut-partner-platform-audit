// Stable codes preserve existing orders. Labels describe intake areas, not blanket capability guarantees.
export const categories=[
 ['PLUMBING','급배수·누수·설비','수전·배수부터 배관 점검·교체까지'],
 ['LOCK','문·도어락','도어락, 손잡이, 문 수리·교체'],
 ['ELECTRIC','전기·조명','조명·스위치부터 전기 설비 개선까지'],
 ['SCREEN','방충망','방충망 교체·보수·설치'],
 ['CURTAIN','커튼·블라인드','일반·전동 제품 설치와 교체'],
 ['FIXTURE','생활·상업 시설 설치','선반, 수납, 욕실 소품, 각종 부착물'],
 ['HVAC','냉난방·환기','에어컨, 환기, 난방 관련 설치·개선'],
 ['SMART_HOME','스마트홈·보안','센서, 홈 IoT, 출입·보안 기기'],
 ['APPLIANCE','가전·기기 설치','가전 설치·이전·연결, 기기 교체'],
 ['WALL_FINISH','도배·도장·필름','벽지, 페인트, 인테리어 필름'],
 ['FLOOR','바닥·타일','장판, 마루, 타일 시공과 보수'],
 ['CARPENTRY','목공·가구','목공 보수, 가구 제작·설치·수정'],
 ['WINDOW','창호·유리','창호, 유리, 단열·기밀 개선'],
 ['KITCHEN_BATH','주방·욕실 공사','주방·욕실의 부분 교체부터 공간 개선까지'],
 ['WATERPROOF','방수·외부 보수','방수, 실리콘, 외부 누수·마감 보수'],
 ['RENOVATION','주거 리모델링','부분·전체 공사, 여러 공종을 함께 조율'],
 ['COMMERCIAL','매장·사무실 공사','상업공간 조성·변경·시설 개선'],
 ['RESTORATION','철거·원상복구','선택 철거, 임대공간 복구, 폐기물 처리 협의'],
 ['MAINTENANCE','청소·공간 관리','입주·이사 청소, 정기 시설 점검·관리'],
 ['UNKNOWN','분야를 모르겠어요','공간과 원하는 결과부터 상담']
] as const;
export const serviceGroups=[
 {name:'설비·전기·기기',codes:['PLUMBING','ELECTRIC','HVAC','SMART_HOME','APPLIANCE'],description:'물이 새는 곳부터 냉난방·전기·기기 설치까지'},
 {name:'문·창·가구',codes:['LOCK','SCREEN','CURTAIN','CARPENTRY','WINDOW'],description:'출입, 단열, 수납과 가구를 함께 개선'},
 {name:'인테리어·마감',codes:['WALL_FINISH','FLOOR','FIXTURE'],description:'벽·바닥 마감과 생활·상업 시설 설치'},
 {name:'주거·상업공간 공사',codes:['KITCHEN_BATH','RENOVATION','COMMERCIAL'],description:'주방·욕실부터 주택, 매장, 사무실 공사까지'},
 {name:'복구·유지관리',codes:['WATERPROOF','RESTORATION','MAINTENANCE'],description:'방수·원상복구와 청소·정기 관리'}
];
export const scopeReviewCodes=['PLUMBING','ELECTRIC','HVAC','SMART_HOME','APPLIANCE','WALL_FINISH','FLOOR','CARPENTRY','WINDOW','KITCHEN_BATH','WATERPROOF','RENOVATION','COMMERCIAL','RESTORATION','MAINTENANCE'];
export const needsScopeReview=(items:string[])=>items.some(v=>scopeReviewCodes.includes(v));
