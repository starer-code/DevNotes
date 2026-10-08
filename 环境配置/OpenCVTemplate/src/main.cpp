#include <opencv2/opencv.hpp>
#include <iostream>

int main()
{
    std::cout << "OpenCV 版本: " << CV_VERSION << std::endl;

    // 生成一张 640x480 的渐变测试图并保存
    cv::Mat img(480, 640, CV_8UC3);
    for (int y = 0; y < img.rows; ++y)
        for (int x = 0; x < img.cols; ++x)
            img.at<cv::Vec3b>(y, x) = cv::Vec3b(
                static_cast<uchar>(x * 255 / img.cols),
                static_cast<uchar>(y * 255 / img.rows),
                128);

    const std::string out = "test_output.png";
    if (cv::imwrite(out, img))
        std::cout << "测试图已保存: " << out << std::endl;
    else
    {
        std::cerr << "保存失败!" << std::endl;
        return 1;
    }
    return 0;
}
